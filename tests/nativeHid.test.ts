/**
 * Tauri版のHID(hid/nativeHid.ts)。RustのhidapiをWebHIDと同じ形に見せる層。
 *
 * 接続の管理・候補の確認・往復はWebHID用のコードをそのまま使うので、ここでは
 * 「WebHIDと同じにふるまうか」を確認する。Rustの側(NativeHidBackend)は偽物に差し替え、
 * 裏にMockTransportのファーム模擬を置いて、WebHidTransport越しに読み込みまで通す。
 */
import { describe, expect, it } from 'vitest'
import { MockTransport } from '@/hid/mockTransport'
import { NativeHid, type NativeHidBackend, type NativeHidInfo } from '@/hid/nativeHid'
import { TransportError, WebHidTransport } from '@/hid/transport'
import { loadKeyboard } from '@/hid/vial'
import type { HidCandidate } from '../src/shared/ipc'

const USB: NativeHidInfo = {
  path: '\\\\?\\HID#VID_E118&PID_0001&MI_01#usb',
  vendorId: 0xe118,
  productId: 0x0001,
  productName: 'Cornix',
  usagePage: 0xff60,
  usage: 0x61,
  bluetooth: false
}
/** 同じキーボードのBluetooth側。VID/PIDは同じで、名前は取れない。 */
const BT: NativeHidInfo = {
  ...USB,
  path: '\\\\?\\HID#{00001812}_Dev_VID&02e118#bt',
  productName: '',
  bluetooth: true
}
/** 別のキーボード(VIA用のインターフェースを持つ無線レシーバー)。 */
const OTHER: NativeHidInfo = {
  ...USB,
  path: '\\\\?\\HID#VID_3434&PID_D026#other',
  vendorId: 0x3434,
  productId: 0xd026,
  productName: 'Keychron Link-KM'
}

/** Rustの側の偽物。書かれた要求にファーム模擬が答え、入力レポートとして返す。 */
class FakeBackend implements NativeHidBackend {
  list: NativeHidInfo[] = []
  granted: NativeHidInfo[] = []
  remembered: NativeHidInfo[] = []
  chooseCalls: HidCandidate[][] = []
  chooseResult: string | null = null
  openCalls = 0
  closed: number[] = []
  failWrite = false
  readonly firmware = new MockTransport({ unlocked: true })
  private readonly reports = new Map<number, (data: Uint8Array) => void>()
  private handlers: Parameters<NativeHidBackend['subscribe']>[0] | null = null

  constructor() {
    void this.firmware.open()
  }

  async devices(grantedOnly: boolean): Promise<NativeHidInfo[]> {
    return this.list.filter(
      (d) => !grantedOnly || this.granted.some((g) => g.vendorId === d.vendorId)
    )
  }
  async remember(device: NativeHidInfo): Promise<void> {
    this.remembered.push(device)
  }
  async choose(candidates: HidCandidate[]): Promise<string | null> {
    this.chooseCalls.push(candidates)
    return this.chooseResult
  }
  async open(_path: string, onReport: (data: Uint8Array) => void): Promise<number> {
    const handle = ++this.openCalls
    this.reports.set(handle, onReport)
    return handle
  }
  async write(handle: number, data: Uint8Array): Promise<void> {
    if (this.failWrite) throw 'デバイスが見つからない' // Rustからは文字列で来る
    expect(data[0]).toBe(0) // 先頭はレポートID
    const response = await this.firmware.send(data.slice(1))
    setTimeout(() => this.reports.get(handle)?.(response), 1)
  }
  async close(handle: number): Promise<void> {
    this.closed.push(handle)
    this.reports.delete(handle)
  }
  subscribe(handlers: Parameters<NativeHidBackend['subscribe']>[0]): () => void {
    this.handlers = handlers
    return () => undefined
  }

  plug(device: NativeHidInfo): void {
    this.handlers?.connect(device)
  }
  unplug(device: NativeHidInfo): void {
    this.handlers?.disconnect(device)
  }
}

function setup(): { backend: FakeBackend; hid: NativeHid } {
  const backend = new FakeBackend()
  return { backend, hid: new NativeHid(backend) }
}

describe('NativeHid: デバイスを選ぶ', () => {
  it('同じキーボードがUSBとBTで見えていても、選ばせずに先頭を使って覚える', async () => {
    const { backend, hid } = setup()
    backend.list = [USB, BT]
    const picked = await hid.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] })
    expect(picked.map((d) => d.info)).toEqual([USB])
    expect(backend.chooseCalls).toEqual([])
    expect(backend.remembered).toEqual([USB])
  })

  it('別々のキーボードが並んでいれば選ばせる。取り消したら何も覚えない', async () => {
    const { backend, hid } = setup()
    backend.list = [OTHER, USB]
    backend.chooseResult = USB.path
    const picked = await hid.requestDevice({ filters: [] })
    expect(picked.map((d) => d.info)).toEqual([USB])
    expect(backend.chooseCalls[0]).toEqual([
      {
        deviceId: OTHER.path,
        name: 'Keychron Link-KM',
        vendorId: 0x3434,
        productId: 0xd026,
        bluetooth: false,
        remembered: false
      },
      {
        deviceId: USB.path,
        name: 'Cornix',
        vendorId: 0xe118,
        productId: 0x0001,
        bluetooth: false,
        remembered: false
      }
    ])

    backend.remembered = []
    backend.chooseResult = null
    expect(await hid.requestDevice({ filters: [] })).toEqual([])
    expect(backend.remembered).toEqual([])
  })

  it('前に接続したキーボードを先頭に並べ、Bluetoothなら印を付ける。自動では選ばない', async () => {
    // BTのCornix(名前はRustが覚えた名前で補う)と、VIA用のインターフェースを持つ別の機器が並ぶ場面
    const { backend, hid } = setup()
    const btCornix = { ...BT, productName: 'Cornix' }
    backend.list = [OTHER, btCornix]
    backend.granted = [USB]
    backend.chooseResult = btCornix.path
    const picked = await hid.requestDevice({ filters: [] })
    expect(picked.map((d) => d.info)).toEqual([btCornix])
    expect(
      backend.chooseCalls[0].map(({ name, bluetooth, remembered }) => ({
        name,
        bluetooth,
        remembered
      }))
    ).toEqual([
      { name: 'Cornix', bluetooth: true, remembered: true },
      { name: 'Keychron Link-KM', bluetooth: false, remembered: false }
    ])
  })

  it('抜き差しの知らせで先に作ったデバイスも、一覧を取り直せば名前が入る', async () => {
    // 知らせは名前を補う前のまま届く(Rustが名前を補うのは一覧を返すとき)
    const { backend, hid } = setup()
    backend.granted = [USB]
    backend.plug(BT)
    backend.list = [{ ...BT, productName: 'Cornix' }]
    const [device] = await hid.getDevices()
    expect(device.productName).toBe('Cornix')
  })

  it('条件に合うものが無ければ空', async () => {
    const { backend, hid } = setup()
    backend.list = [OTHER]
    expect(await hid.requestDevice({ filters: [{ vendorId: 0xe118 }] })).toEqual([])
  })

  it('getDevicesは許可したものだけ。同じパスには同じオブジェクトを返す', async () => {
    const { backend, hid } = setup()
    backend.list = [USB, OTHER]
    backend.granted = [USB]
    const first = await hid.getDevices()
    const second = await hid.getDevices()
    expect(first.map((d) => d.info)).toEqual([USB])
    expect(second[0]).toBe(first[0])
  })
})

describe('NativeHid: 挿し抜き', () => {
  it('connect / disconnectをWebHIDと同じ形で配る', async () => {
    const { backend, hid } = setup()
    backend.list = [USB]
    backend.granted = [USB]
    const [device] = await hid.getDevices()
    const events: Array<[string, unknown]> = []
    const record = (event: Event): void => {
      events.push([event.type, (event as HIDConnectionEvent).device])
    }
    hid.addEventListener('connect', record)
    hid.addEventListener('disconnect', record)

    backend.unplug(USB)
    backend.plug(USB)
    // 抜けたのは持っていたオブジェクト。挿し直したら別のオブジェクトになる(WebHIDと同じ)
    expect(events[0]).toEqual(['disconnect', device])
    expect(events[1][0]).toBe('connect')
    expect(events[1][1]).not.toBe(device)
    expect(await hid.getDevices()).toEqual([events[1][1]])
  })
})

describe('NativeHidDevice', () => {
  it('二重に開いてもハンドルは1つ。閉じたらRustにも閉じさせる', async () => {
    const { backend, hid } = setup()
    backend.list = [USB]
    const [device] = await hid.requestDevice({ filters: [] })
    await Promise.all([device.open(), device.open()])
    expect(backend.openCalls).toBe(1)
    expect(device.opened).toBe(true)
    await device.close()
    expect(device.opened).toBe(false)
    expect(backend.closed).toEqual([1])
  })

  it('書けなければTransportErrorではないErrorで失敗する(時間切れと区別して、待たずに切る)', async () => {
    const { backend, hid } = setup()
    backend.list = [USB]
    const [device] = await hid.requestDevice({ filters: [] })
    await expect(device.sendReport(0, new Uint8Array(32))).rejects.toThrow('開かれていない')

    await device.open()
    backend.failWrite = true
    const failure = device.sendReport(0, new Uint8Array(32))
    await expect(failure).rejects.toThrow('デバイスが見つからない')
    await expect(failure).rejects.not.toBeInstanceOf(TransportError)
  })

  it('WebHidTransport越しにキーボードを読み込める', async () => {
    const { backend, hid } = setup()
    backend.list = [USB]
    const [device] = await hid.requestDevice({ filters: [] })
    const transport = new WebHidTransport(device as unknown as HIDDevice)
    await transport.open()
    expect(transport.label).toBe('Cornix')

    const keyboard = await loadKeyboard(transport)
    expect(keyboard.layers).toBeGreaterThan(0)
    expect(keyboard.keymap.length).toBe(keyboard.layers)
    await transport.close()
    expect(device.opened).toBe(false)
  })
})
