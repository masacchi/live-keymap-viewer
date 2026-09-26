/**
 * デバイスとの32バイト往復を抽象化する層。
 *
 * ファームはリクエストとレスポンスを対応づけるIDを持たないので、
 * 実装側で必ず直列化する。matrixポーリングとキーマップ読み出しが
 * 並走すると応答を取り違える(docs/PROTOCOL.md §7)。
 */
import { MSG_LEN, VIAL_USAGE, VIAL_USAGE_PAGE } from './constants'

export interface SendOptions {
  /**
   * 応答が来るまでの待ち時間の最低値。往復が遅い接続(Bluetooth)では、測った往復時間に合わせて
   * これより長く待つ(WebHidTransportのtimeoutFor)。
   */
  timeoutMs?: number
  /** タイムアウトしたときに投げ直す回数。 */
  retries?: number
  /**
   * 受け取ったパケットが、このリクエストへの応答かどうかを判定する。
   *
   * raw HIDの入力レポートは、そのHIDを開いている**すべて**のプロセスに配られる。
   * つまりVialやPipetteを同時に開いていると、相手宛ての応答もこちらに届く。
   * ここで弾かないと、matrixの値やキーマップが他アプリの応答で汚れる。
   * falseを返したパケットは捨てて、タイムアウトまで待ち続ける。
   */
  validate?: (data: Uint8Array) => boolean
}

export interface Transport {
  /** 画面に出す名前。 */
  readonly label: string
  readonly opened: boolean
  /**
   * 覚えている往復時間(ms)。測っていなければnull、測らない実装(モック)はundefined。
   * 画面に出して、USB(数ms)かBluetooth(450ms前後)か、詰まっていないかの手がかりにする。
   */
  readonly roundTripMs?: number | null
  open(): Promise<void>
  close(): Promise<void>
  /** 32バイト以内のリクエストを送り、32バイトのレスポンスを返す。 */
  send(request: Uint8Array, options?: SendOptions): Promise<Uint8Array>
}

export class TransportError extends Error {}

/** リクエストを32バイトに詰める。 */
export function pad(bytes: ArrayLike<number>): Uint8Array {
  if (bytes.length > MSG_LEN) {
    throw new TransportError(`リクエストが${MSG_LEN}バイトを超えている`)
  }
  const out = new Uint8Array(MSG_LEN)
  out.set(bytes)
  return out
}

/** 送信を1本のキューに並べる。Transport実装から使う。 */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job)
    // キューが途中の失敗で止まらないようにする
    this.tail = next.catch(() => undefined)
    return next
  }
}

/**
 * タイムアウトで諦めた要求への応答が、あとから届くかもしれない窓(ms)。
 * これを過ぎても届かなければ、要求ごと失われたと見なして数え直す。
 */
export const STALE_RESPONSE_WINDOW_MS = 2000

/**
 * タイムアウトを往復時間の何倍にするか。往復は揺れる(Bluetoothは実測444〜488ms)ので余裕を持たせる。
 */
export const TIMEOUT_PER_ROUND_TRIP = 3

/** 往復時間から決めるタイムアウトの上限(ms)。これ以上待っても答えないものは、答えないとみなす。 */
export const MAX_ADAPTIVE_TIMEOUT_MS = 2000

/** 往復時間が短くなったときに、覚えている値を寄せる割合。長くなったときはすぐにその値にする。 */
const ROUND_TRIP_DECAY = 0.1

export interface WebHidTransportOptions {
  /** 諦めた応答を待つ窓。テストで縮める。 */
  staleWindowMs?: number
}

/** 待っている要求。往復時間が分かったら、期限を延ばせるように持っておく。 */
interface PendingRequest {
  /** 受け取ったパケットを渡す。引き取ったらtrue、自分宛てでなければfalse。 */
  deliver: (data: Uint8Array) => boolean
  /** いまの往復時間に合わせて期限を延ばす。 */
  extend: () => void
}

/**
 * WebHID上の実デバイス。
 *
 * **タイムアウトは往復時間に合わせて延ばす。** Bluetoothの往復は450ms前後あり(docs/BLUETOOTH.md §2.4)、
 * USB向けのタイムアウト(matrixは200ms)より長い。タイムアウトしてから送り直すと、遅れて届いた前の
 * 応答は捨てる(abandoned)が、送り直した方もまた間に合わず、いつまでも読めない。そこで届いた応答から
 * 往復時間を覚え、呼び出し側のタイムアウトと「往復時間 × 3」の長い方まで待つ。**タイムアウトして
 * 捨てる応答からも往復時間を測る**ので、最初の1回が間に合わなくても、待っている要求の期限をその場で
 * 延ばして追いつける。答えないデバイスは往復時間が測れないので、待つ時間は延びない。
 */
export class WebHidTransport implements Transport {
  private readonly queue = new RequestQueue()
  private pending: PendingRequest | null = null
  /**
   * タイムアウトで諦めた要求の、送った時刻と諦めた時刻(送った順)。この数だけ、届いた応答を捨てる。
   *
   * ファームは応答に要求IDを持たない(docs/PROTOCOL.md §7)。諦めた要求への応答が遅れて
   * 届くと、**投げ直した要求の応答として受け取ってしまい、以後ずっと1回ずつずれる**
   * (docs/BLUETOOTH.md §3)。同じコマンドなので照合(validate)では弾けない。
   * 応答は送った順に返るので、諦めた数だけ捨てれば並びが戻る。
   */
  private abandoned: Array<{ sentAt: number; abandonedAt: number }> = []
  /** 覚えている往復時間(ms)。まだ測っていなければnull。 */
  private roundTrip: number | null = null
  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const now = performance.now()
    const latest = this.abandoned.at(-1)
    if (latest) {
      // 最後に諦めてから窓を過ぎても届かなければ、応答ごと失われたとみなして数え直す
      if (now - latest.abandonedAt <= this.staleWindowMs) {
        const stale = this.abandoned.shift()
        if (stale) this.recordRoundTrip(now - stale.sentAt)
        this.pending?.extend()
        return // 諦めた要求への応答。捨てて並びを戻す
      }
      this.abandoned = []
    }
    const pending = this.pending
    if (!pending) return // 取りこぼしたレスポンス(タイムアウト後など)は捨てる
    const data = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength)
    )
    if (pending.deliver(data)) this.pending = null
  }

  private readonly staleWindowMs: number

  constructor(
    private readonly device: HIDDevice,
    options: WebHidTransportOptions = {}
  ) {
    this.staleWindowMs = options.staleWindowMs ?? STALE_RESPONSE_WINDOW_MS
  }

  get label(): string {
    return this.device.productName || 'Vial keyboard'
  }

  get opened(): boolean {
    return this.device.opened
  }

  /** 覚えている往復時間(ms)。まだ応答を受け取っていなければnull。 */
  get roundTripMs(): number | null {
    return this.roundTrip
  }

  /**
   * 実際に待つ時間。呼び出し側の値を最低にして、往復が遅ければ往復時間の3倍まで延ばす
   * (上限MAX_ADAPTIVE_TIMEOUT_MS)。USBの往復は数msなので、ふだんは呼び出し側の値のまま。
   */
  timeoutFor(requestedMs: number): number {
    if (this.roundTrip === null) return requestedMs
    const adaptive = Math.min(MAX_ADAPTIVE_TIMEOUT_MS, this.roundTrip * TIMEOUT_PER_ROUND_TRIP)
    return Math.max(requestedMs, adaptive)
  }

  /**
   * 往復時間を覚える。長くなったらすぐその値に、短くなったらゆっくり寄せる。
   * 一瞬の詰まりで延びたタイムアウトは、応答が速く戻るうちに少しずつ元に戻る。
   */
  private recordRoundTrip(sample: number): void {
    const current = this.roundTrip
    this.roundTrip =
      current === null || sample >= current
        ? sample
        : current + (sample - current) * ROUND_TRIP_DECAY
  }

  async open(): Promise<void> {
    this.abandoned = []
    if (!this.device.opened) await this.device.open()
    // 二重に開かれてもリスナーが重ならないように、いったん外してから付ける
    this.device.removeEventListener('inputreport', this.onInputReport)
    this.device.addEventListener('inputreport', this.onInputReport)
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.onInputReport)
    if (this.device.opened) await this.device.close()
  }

  send(request: Uint8Array, options: SendOptions = {}): Promise<Uint8Array> {
    const { timeoutMs = 500, retries = 1, validate } = options
    const payload = pad(request)
    return this.queue.run(async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < Math.max(1, retries); attempt++) {
        try {
          return await this.exchange(payload, timeoutMs, validate)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new TransportError('デバイスと通信できませんでした')
    })
  }

  private exchange(
    payload: Uint8Array,
    timeoutMs: number,
    validate?: (data: Uint8Array) => boolean
  ): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const sentAt = performance.now()
      let deadline = sentAt + this.timeoutFor(timeoutMs)
      let timer: ReturnType<typeof setTimeout> | undefined
      const expire = (): void => {
        this.pending = null
        // 諦めるだけで、応答はあとから届くかもしれない。届いたら捨てて並びを戻す
        this.abandoned.push({ sentAt, abandonedAt: performance.now() })
        reject(new TransportError(`デバイスが応答しません(コマンド${describeCommand(payload)})`))
      }
      const arm = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(expire, Math.max(0, deadline - performance.now()))
      }
      this.pending = {
        deliver: (data) => {
          // 他アプリ宛ての応答は捨てて、こちらの応答が来るまで待つ
          if (validate && !validate(data)) return false
          if (timer !== undefined) clearTimeout(timer)
          this.recordRoundTrip(performance.now() - sentAt)
          resolve(data)
          return true
        },
        extend: () => {
          const extended = sentAt + this.timeoutFor(timeoutMs)
          if (extended <= deadline) return
          deadline = extended
          arm()
        }
      }
      arm()
      // report IDを持たないデバイスなので0で送る
      const report = new Uint8Array(MSG_LEN)
      report.set(payload)
      this.device.sendReport(0x00, report).catch((error: unknown) => {
        if (timer !== undefined) clearTimeout(timer)
        this.pending = null
        reject(error instanceof Error ? error : new TransportError(String(error)))
      })
    })
  }
}

/** エラー表示用に、リクエストの先頭(コマンドとサブコマンド)を16進で表す。 */
export function describeCommand(payload: Uint8Array): string {
  const head =
    payload[0] === 0xfe || payload[0] === 0x02 ? payload.subarray(0, 2) : payload.subarray(0, 1)
  return [...head].map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')
}

/** Vialのraw HIDインターフェースを持つデバイスかどうか。 */
export function isVialDevice(device: HIDDevice): boolean {
  return device.collections.some(
    (collection) => collection.usagePage === VIAL_USAGE_PAGE && collection.usage === VIAL_USAGE
  )
}

/** WebHIDのデバイス要求に使うフィルタ。 */
export const VIAL_HID_FILTERS: HIDDeviceFilter[] = [
  { usagePage: VIAL_USAGE_PAGE, usage: VIAL_USAGE }
]
