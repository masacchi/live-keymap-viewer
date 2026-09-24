/**
 * デバイスとの32バイト往復を抽象化する層。
 *
 * ファームはリクエストとレスポンスを対応づけるIDを持たないので、
 * 実装側で必ず直列化する。matrixポーリングとキーマップ読み出しが
 * 並走すると応答を取り違える(docs/PROTOCOL.md §7)。
 */
import { MSG_LEN, VIAL_USAGE, VIAL_USAGE_PAGE } from './constants'

export interface SendOptions {
  /** 応答が来るまでの待ち時間。 */
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
  open(): Promise<void>
  close(): Promise<void>
  /** 32バイト以内のリクエストを送り、32バイトのレスポンスを返す。 */
  send(request: Uint8Array, options?: SendOptions): Promise<Uint8Array>
}

export class TransportError extends Error {}

/** リクエストを32バイトに詰める。 */
export function pad(bytes: ArrayLike<number>): Uint8Array {
  if (bytes.length > MSG_LEN) {
    throw new TransportError(`リクエストが ${MSG_LEN} バイトを超えている`)
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
 * 時間切れで諦めた要求への応答が、あとから届くかもしれない窓(ms)。
 * これを過ぎても届かなければ、要求ごと失われたと見なして数え直す。
 */
export const STALE_RESPONSE_WINDOW_MS = 2000

export interface WebHidTransportOptions {
  /** 諦めた応答を待つ窓。テストで縮める。 */
  staleWindowMs?: number
}

/** WebHID上の実デバイス。 */
export class WebHidTransport implements Transport {
  private readonly queue = new RequestQueue()
  /** 受け取ったパケットを渡す。引き取ったらtrue、自分宛てでなければfalse。 */
  private pending: ((data: Uint8Array) => boolean) | null = null
  /**
   * 時間切れで諦めた要求の数。この数だけ、届いた応答を捨てる。
   *
   * ファームは応答に要求IDを持たない(docs/PROTOCOL.md §7)。諦めた要求への応答が遅れて
   * 届くと、**投げ直した要求の応答として受け取ってしまい、以後ずっと1回ずつずれる**
   * (docs/BLUETOOTH.md §3)。同じコマンドなので照合(validate)では弾けない。
   * 応答は送った順に返るので、諦めた数だけ捨てれば並びが戻る。
   */
  private abandoned = 0
  /** 諦めた時刻。窓を過ぎても届かなければ、要求ごと失われたとみなして数え直す。 */
  private abandonedAt = 0
  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    if (this.abandoned > 0) {
      if (Date.now() - this.abandonedAt <= this.staleWindowMs) {
        this.abandoned-- // 諦めた要求への応答。捨てて並びを戻す
        return
      }
      this.abandoned = 0 // 窓を過ぎた。応答ごと失われたのだろう
    }
    const deliver = this.pending
    if (!deliver) return // 取りこぼしたレスポンス(タイムアウト後など)は捨てる
    const data = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength)
    )
    if (deliver(data)) this.pending = null
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

  async open(): Promise<void> {
    this.abandoned = 0
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
      let timer: ReturnType<typeof setTimeout> | undefined
      this.pending = (data) => {
        // 他アプリ宛ての応答は捨てて、こちらの応答が来るまで待つ
        if (validate && !validate(data)) return false
        if (timer !== undefined) clearTimeout(timer)
        resolve(data)
        return true
      }
      timer = setTimeout(() => {
        this.pending = null
        // 諦めるだけで、応答はあとから届くかもしれない。届いたら捨てて並びを戻す
        this.abandoned++
        this.abandonedAt = Date.now()
        reject(new TransportError(`デバイスが応答しません(コマンド ${describeCommand(payload)})`))
      }, timeoutMs)
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
