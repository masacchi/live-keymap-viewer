/**
 * デスクトップ版のHID。Rust(src-tauri/src/hid.rs)のhidapiを、WebHIDと同じ形に見せる。
 *
 * 画面(WebView2)にはWebHIDの許可や選択ダイアログを差し込む口が無い(docs/ARCHITECTURE.md §2)。
 * そこでHIDはRustで扱い、ここで`navigator.hid`と`HIDDevice`のうち**アプリが使うところだけ**を作る。
 * そうしておけば、接続の管理(session/keyboardConnection.ts)・候補の確認(deviceProbe.ts)・
 * 往復(transport.tsのWebHidTransport)は、ブラウザのWebHIDと同じコードのまま動く。
 *
 * Rustを呼ぶところはNativeHidBackendにまとめてある(platform/tauri.ts)。テストでは偽物に差し替える。
 */
import type { HidCandidate } from '../../../shared/ipc'

/** Rustから来るデバイスの情報(src-tauri/src/hid.rsのHidDeviceInfo)。 */
export interface NativeHidInfo {
  /** OSのデバイスパス。開くときと、同じものかを見分けるのに使う。 */
  path: string
  vendorId: number
  productId: number
  /** 製品名。Bluetoothでは取れず空のことがあり、そのときは許可したときに覚えた名前が入る。 */
  productName: string
  usagePage: number
  usage: number
  /** Bluetoothで接続しているか(パスから判断する。src-tauri/src/hid.rs)。 */
  bluetooth: boolean
}

export interface NativeHidBackend {
  /** Vialのインターフェースの一覧。grantedOnlyなら一度許可したもの(VID/PID)だけ。 */
  devices(grantedOnly: boolean): Promise<NativeHidInfo[]>
  /** 選ばれたキーボードを覚える(次の起動から自動で接続する)。 */
  remember(device: NativeHidInfo): Promise<void>
  /** 別々のキーボードが並んでいるとき、どれに接続するかを選んでもらう。取り消されたらnull。 */
  choose(candidates: HidCandidate[]): Promise<string | null>
  /** 開いて、入力レポート(32バイト)をonReportに流す。閉じるときに使う番号を返す。 */
  open(path: string, onReport: (data: Uint8Array) => void): Promise<number>
  /** 1つのレポートを書く。先頭の1バイトはレポートID。 */
  write(handle: number, data: Uint8Array): Promise<void>
  close(handle: number): Promise<void>
  /** 抜き差しの知らせを受ける。戻り値を呼ぶと解除。 */
  subscribe(handlers: {
    connect(device: NativeHidInfo): void
    disconnect(device: NativeHidInfo): void
  }): () => void
}

/** `HIDDevice`のうち、アプリが使うところ。 */
export class NativeHidDevice extends EventTarget {
  private handle: number | null = null
  private opening: Promise<void> | null = null
  readonly collections: HIDCollectionInfo[]

  constructor(
    /**
     * 最後に受け取った情報。一覧を取り直すたびに差し替える。抜き差しの知らせで先に作られたときは
     * 名前が空のままなので(覚えた名前で補うのは一覧を返すとき)、取り直したものに合わせる
     */
    public info: NativeHidInfo,
    private readonly backend: NativeHidBackend
  ) {
    super()
    // isVialDevice(transport.ts)が見るのはusagePageとusageだけ
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
    // 開いている途中にもう一度呼ばれても、ハンドルを2つ作らない
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
    // WebHIDと同じく、書けないときはTransportErrorではないErrorで失敗させる。
    // セッションはTransportError(タイムアウト)でなければ待たずに切る(session/keyboardSession.ts)
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

/** `navigator.hid`のうち、アプリが使うところ(session/keyboardConnection.tsのHidLike)。 */
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
        // 挿し直したら別のデバイスとして扱う(WebHIDと同じ)
        this.known.delete(info.path)
        this.dispatchEvent(connectionEvent('disconnect', device))
      }
    })
  }

  async getDevices(): Promise<NativeHidDevice[]> {
    return (await this.backend.devices(true)).map((info) => this.device(info))
  }

  /**
   * 接続するキーボードを選ぶ(WebHIDの`requestDevice`にあたる)。
   *
   * 同じキーボードがUSBとBluetoothの両方で見えていると、候補が2つになる。
   * 名前もVID/PIDも同じで人には見分けられないし、許可はVID/PID単位なので
   * どちらを選んでも両方が許可される。どちらが答えるかはdeviceProbe.tsが確認する。
   * 選ばせるのは、別々のキーボードが並んでいるときだけ。
   */
  async requestDevice(options: HIDDeviceRequestOptions): Promise<NativeHidDevice[]> {
    const candidates = (await this.backend.devices(false)).filter((info) =>
      matchesFilters(info, options.filters)
    )
    if (candidates.length === 0) return []

    let chosen: NativeHidInfo | undefined = candidates[0]
    const keyboards = new Set(candidates.map(keyboardOf))
    if (keyboards.size > 1) {
      // 前に接続したキーボードは、先頭に並べて印を付ける。自動では選ばない
      // (別のキーボードに接続したいときに、先に「忘れる」を押さないと選べなくなるため)
      const granted = new Set((await this.backend.devices(true)).map(keyboardOf))
      const listed = candidates
        .map((info) => toCandidate(info, granted.has(keyboardOf(info))))
        .sort((a, b) => Number(b.remembered) - Number(a.remembered))
      const deviceId = await this.backend.choose(listed)
      chosen = candidates.find((d) => d.path === deviceId)
    }
    if (!chosen) return []
    await this.backend.remember(chosen)
    return [this.device(chosen)]
  }

  private device(info: NativeHidInfo): NativeHidDevice {
    let device = this.known.get(info.path)
    if (device) {
      device.info = info
    } else {
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

/** どのキーボードか(許可はVID/PID単位。USBとBTの同じキーボードは同じになる)。 */
function keyboardOf(info: NativeHidInfo): string {
  return `${info.vendorId}:${info.productId}`
}

function toCandidate(info: NativeHidInfo, remembered: boolean): HidCandidate {
  return {
    deviceId: info.path,
    name: info.productName,
    vendorId: info.vendorId,
    productId: info.productId,
    bluetooth: info.bluetooth,
    remembered
  }
}

function toBytes(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}
