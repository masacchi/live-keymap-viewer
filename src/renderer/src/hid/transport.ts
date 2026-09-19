/**
 * デバイスとの 32 バイト往復を抽象化する層。
 *
 * ファームはリクエストとレスポンスを対応づける ID を持たないので、
 * 実装側で必ず直列化する。matrix ポーリングとキーマップ読み出しが
 * 並走すると応答を取り違える(docs/PROTOCOL.md §6)。
 */
import { MSG_LEN, VIAL_USAGE, VIAL_USAGE_PAGE } from './constants'

export interface SendOptions {
  /** 応答が来るまでの待ち時間。 */
  timeoutMs?: number
  /** タイムアウトしたときに投げ直す回数。 */
  retries?: number
}

export interface Transport {
  /** 画面に出す名前。 */
  readonly label: string
  readonly opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  /** 32 バイト以内のリクエストを送り、32 バイトのレスポンスを返す。 */
  send(request: Uint8Array, options?: SendOptions): Promise<Uint8Array>
}

export class TransportError extends Error {}

/** リクエストを 32 バイトに詰める。 */
export function pad(bytes: ArrayLike<number>): Uint8Array {
  if (bytes.length > MSG_LEN) {
    throw new TransportError(`リクエストが ${MSG_LEN} バイトを超えている`)
  }
  const out = new Uint8Array(MSG_LEN)
  out.set(bytes)
  return out
}

/** 送信を 1 本のキューに並べる。Transport 実装から使う。 */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job)
    // キューが途中の失敗で止まらないようにする
    this.tail = next.catch(() => undefined)
    return next
  }
}

/** WebHID 上の実デバイス。 */
export class WebHidTransport implements Transport {
  private readonly queue = new RequestQueue()
  private pending: ((data: Uint8Array) => void) | null = null
  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const resolve = this.pending
    if (!resolve) return // 取りこぼしたレスポンス(タイムアウト後など)は捨てる
    this.pending = null
    resolve(new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength)))
  }

  constructor(private readonly device: HIDDevice) {}

  get label(): string {
    return this.device.productName || 'Vial keyboard'
  }

  get opened(): boolean {
    return this.device.opened
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open()
    this.device.addEventListener('inputreport', this.onInputReport)
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.onInputReport)
    if (this.device.opened) await this.device.close()
  }

  send(request: Uint8Array, options: SendOptions = {}): Promise<Uint8Array> {
    const { timeoutMs = 500, retries = 1 } = options
    const payload = pad(request)
    return this.queue.run(async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < Math.max(1, retries); attempt++) {
        try {
          return await this.exchange(payload, timeoutMs)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new TransportError('デバイスと通信できなかった')
    })
  }

  private exchange(payload: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      this.pending = (data) => {
        if (timer !== undefined) clearTimeout(timer)
        resolve(data)
      }
      timer = setTimeout(() => {
        this.pending = null
        reject(new TransportError('デバイスが応答しない'))
      }, timeoutMs)
      // report ID を持たないデバイスなので 0 で送る
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

/** Vial の raw HID インターフェースを持つデバイスかどうか。 */
export function isVialDevice(device: HIDDevice): boolean {
  return device.collections.some(
    (collection) =>
      collection.usagePage === VIAL_USAGE_PAGE && collection.usage === VIAL_USAGE
  )
}

/** WebHID のデバイス要求に使うフィルタ。 */
export const VIAL_HID_FILTERS: HIDDeviceFilter[] = [
  { usagePage: VIAL_USAGE_PAGE, usage: VIAL_USAGE }
]
