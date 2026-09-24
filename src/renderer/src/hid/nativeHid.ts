/**
 * Tauri 版の HID。Rust(src-tauri/src/hid.rs)の hidapi を、WebHID と同じ形に見せる。
 *
 * Tauri の画面は WebView2 で、WebHID の許可や選択ダイアログを差し込む口が無い
 * (docs/ARCHITECTURE.md §2)。そこで HID は Rust で扱い、ここで `navigator.hid` と `HIDDevice` の
 * うち**アプリが使うところだけ**を作る。そうしておけば、接続の管理(session/keyboardConnection.ts)・
 * 候補の確かめ(deviceProbe.ts)・往復(transport.ts の WebHidTransport)は、ブラウザの WebHID と
 * 同じコードのまま動く。
 *
 * Rust を呼ぶところは NativeHidBackend にまとめてある(platform/tauri.ts)。テストでは偽物に差し替える。
 */
import type { HidCandidate } from '../../../shared/ipc'

/** Rust から来るデバイスの情報(src-tauri/src/hid.rs の HidDeviceInfo)。 */
export interface NativeHidInfo {
  /** OS のデバイスパス。開くときと、同じものかを見分けるのに使う。 */
  path: string
  vendorId: number
  productId: number
  /** 製品名。Bluetooth では取れず空のことがある。 */
  productName: string
  usagePage: number
  usage: number
}

export interface NativeHidBackend {
  /** Vial のインターフェースを並べる。grantedOnly なら一度許可したもの(VID/PID)だけ。 */
  devices(grantedOnly: boolean): Promise<NativeHidInfo[]>
  /** 選ばれたキーボードを覚える(次の起動から自動で繋ぐ)。 */
  remember(device: NativeHidInfo): Promise<void>
  /** 別々のキーボードが並んでいるとき、どれに繋ぐかを人に選ばせる。取り消されたら null。 */
  choose(candidates: HidCandidate[]): Promise<string | null>
  /** 開いて、入力レポート(32 バイト)を onReport に流す。閉じるのに使う番号を返す。 */
  open(path: string, onReport: (data: Uint8Array) => void): Promise<number>
  /** 1 つのレポートを書く。先頭の 1 バイトはレポート ID。 */
  write(handle: number, data: Uint8Array): Promise<void>
  close(handle: number): Promise<void>
  /** 挿し抜きの知らせを受ける。戻り値を呼ぶと解除。 */
  subscribe(handlers: {
    connect(device: NativeHidInfo): void
    disconnect(device: NativeHidInfo): void
  }): () => void
}

/** `HIDDevice` のうち、アプリが使うところ。 */
export class NativeHidDevice extends EventTarget {
  private handle: number | null = null
  private opening: Promise<void> | null = null
  readonly collections: HIDCollectionInfo[]

  constructor(
    readonly info: NativeHidInfo,
    private readonly backend: NativeHidBackend
  ) {
    super()
    // isVialDevice(transport.ts)が見るのは usagePage と usage だけ
    this.collections = [{ usagePage: info.usagePage, usage: info.usage } as HIDCollectionInfo]
  }

  get opened(): boolean {
    return this.handle !== null
  }

  get productName(): string {
    return this.info.productName
  }

  get vendorId(): number {
    return this.info.vendorId
  }

  get productId(): number {
    return this.info.productId
  }

  open(): Promise<void> {
    if (this.handle !== null) return Promise.resolve()
    // 開いている途中にもう一度呼ばれても、ハンドルを 2 つ作らない
    this.opening ??= this.backend
      .open(this.info.path, (data) => this.deliver(data))
      .then((handle) => {
        this.handle = handle
      })
      .finally(() => {
        this.opening = null
      })
    return this.opening
  }

  async close(): Promise<void> {
    await this.opening?.catch(() => undefined)
    const handle = this.handle
    if (handle === null) return
    this.handle = null
    await this.backend.close(handle)
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    const handle = this.handle
    // WebHID と同じく、書けないときは TransportError ではない Error で失敗させる。
    // セッションは TransportError(時間切れ)でなければ待たずに切る(session/keyboardSession.ts)
    if (handle === null) throw new Error('デバイスが開かれていない')
    const body = toBytes(data)
    const report = new Uint8Array(body.length + 1)
    report[0] = reportId
    report.set(body, 1)
    try {
      await this.backend.write(handle, report)
    } catch (error) {
      throw new Error(`デバイスに書き込めなかった: ${String(error)}`)
    }
  }

  private deliver(data: Uint8Array): void {
    const event = Object.assign(new Event('inputreport'), {
      device: this,
      reportId: 0,
      data: new DataView(data.buffer, data.byteOffset, data.byteLength)
    })
    this.dispatchEvent(event)
  }
}

/** `navigator.hid` のうち、アプリが使うところ(session/keyboardConnection.ts の HidLike)。 */
export class NativeHid extends EventTarget {
  /** 同じパスには同じオブジェクトを返す。接続の管理は、切れたデバイスを === で見分けている。 */
  private readonly known = new Map<string, NativeHidDevice>()

  constructor(private readonly backend: NativeHidBackend) {
    super()
    // 画面が開いているあいだずっと使うので、解除しない
    backend.subscribe({
      connect: (info) => this.dispatchEvent(connectionEvent('connect', this.device(info))),
      disconnect: (info) => {
        const device = this.known.get(info.path) ?? new NativeHidDevice(info, backend)
        // 挿し直したら別のデバイスとして扱う(WebHID と同じ)
        this.known.delete(info.path)
        this.dispatchEvent(connectionEvent('disconnect', device))
      }
    })
  }

  async getDevices(): Promise<NativeHidDevice[]> {
    return (await this.backend.devices(true)).map((info) => this.device(info))
  }

  /**
   * 繋ぐキーボードを選ぶ。Electron 版で main が select-hid-device でしていたことと同じ。
   *
   * 同じキーボードが USB と Bluetooth の両方で見えていると、候補が 2 つになる。
   * 名前も VID/PID も同じで人には見分けられないし、許可は VID/PID 単位なので
   * どちらを選んでも両方が許可される。どちらが答えるかは deviceProbe.ts が確かめる。
   * 選ばせるのは、別々のキーボードが並んでいるときだけ。
   */
  async requestDevice(options: HIDDeviceRequestOptions): Promise<NativeHidDevice[]> {
    const candidates = (await this.backend.devices(false)).filter((info) =>
      matchesFilters(info, options.filters)
    )
    if (candidates.length === 0) return []

    let chosen: NativeHidInfo | undefined = candidates[0]
    const keyboards = new Set(candidates.map((d) => `${d.vendorId}:${d.productId}`))
    if (keyboards.size > 1) {
      const deviceId = await this.backend.choose(candidates.map(toCandidate))
      chosen = candidates.find((d) => d.path === deviceId)
    }
    if (!chosen) return []
    await this.backend.remember(chosen)
    return [this.device(chosen)]
  }

  private device(info: NativeHidInfo): NativeHidDevice {
    let device = this.known.get(info.path)
    if (!device) {
      device = new NativeHidDevice(info, this.backend)
      this.known.set(info.path, device)
    }
    return device
  }
}

function connectionEvent(type: 'connect' | 'disconnect', device: NativeHidDevice): Event {
  return Object.assign(new Event(type), { device })
}

function matchesFilters(info: NativeHidInfo, filters: readonly HIDDeviceFilter[]): boolean {
  if (filters.length === 0) return true
  return filters.some(
    (f) =>
      (f.vendorId === undefined || f.vendorId === info.vendorId) &&
      (f.productId === undefined || f.productId === info.productId) &&
      (f.usagePage === undefined || f.usagePage === info.usagePage) &&
      (f.usage === undefined || f.usage === info.usage)
  )
}

function toCandidate(info: NativeHidInfo): HidCandidate {
  return {
    deviceId: info.path,
    name: info.productName,
    vendorId: info.vendorId,
    productId: info.productId
  }
}

function toBytes(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}
