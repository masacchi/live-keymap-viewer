/**
 * WebHidTransportを本物と同じ経路で動かすための、偽のHIDDevice。
 * tests/webhidTransport.test.tsとtests/bluetoothLatency.test.tsで使う。
 */
import { MockTransport } from '@/hid/mockTransport'

export const asHid = (device: EventTarget): HIDDevice => device as unknown as HIDDevice

/** sendReportを受けると、ファーム模擬の応答をinputreportとして返す偽デバイス。 */
export class FirmwareBackedDevice extends EventTarget {
  opened = false
  productName = 'Cornix (fake HID)'
  collections = [{ usagePage: 0xff60, usage: 0x61 }]
  readonly firmware: MockTransport
  /** 応答を返すまでの遅れ(ms)。 */
  latencyMs = 1
  /** 次の1往復だけ、さらにこれだけ遅らせる(詰まりの再現)。 */
  stallNextMs = 0
  /** この数だけ、応答を握りつぶす(要求ごと失われた場合の再現)。 */
  dropNext = 0
  /** 応答は送った順に返す(実機と同じ)。詰まった応答を追い越さない。 */
  private chain: Promise<void> = Promise.resolve()

  constructor(unlocked: boolean) {
    super()
    this.firmware = new MockTransport({ unlocked })
    void this.firmware.open()
  }

  async open(): Promise<void> {
    this.opened = true
  }
  async close(): Promise<void> {
    this.opened = false
  }
  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    if (!this.opened) throw new Error('device is not opened')
    if (reportId !== 0) throw new Error(`unexpected report id ${reportId}`)
    const request = new Uint8Array(data as ArrayBuffer)
    if (request.length !== 32) throw new Error(`report must be 32 bytes, got ${request.length}`)
    const response = await this.firmware.send(request)
    if (this.dropNext > 0) {
      this.dropNext--
      return
    }
    const delay = this.latencyMs + this.stallNextMs
    this.stallNextMs = 0
    this.chain = this.chain.then(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            const event = new Event('inputreport')
            Object.defineProperty(event, 'data', { value: new DataView(response.slice().buffer) })
            Object.defineProperty(event, 'reportId', { value: 0 })
            this.dispatchEvent(event)
            resolve()
          }, delay)
        })
    )
  }
}

/** 何を送っても答えない偽デバイス(出力先でない側のBluetoothインターフェースのような)。 */
export class SilentDevice extends EventTarget {
  opened = false
  productName = 'Cornix (silent)'
  collections = [{ usagePage: 0xff60, usage: 0x61 }]
  async open(): Promise<void> {
    this.opened = true
  }
  async close(): Promise<void> {
    this.opened = false
  }
  async sendReport(): Promise<void> {}
}

/**
 * VIAだけの機器(Keychron Linkのような無線レシーバー)。usage pageがVialと同じなので候補に並ぶが、
 * Vialのコマンドは知らないので、VIAのファームと同じく`data[0]`を`0xFF`(id_unhandled)にして返す。
 */
export class ViaOnlyDevice extends EventTarget {
  opened = false
  productName = 'Keychron Link (fake)'
  collections = [{ usagePage: 0xff60, usage: 0x61 }]
  async open(): Promise<void> {
    this.opened = true
  }
  async close(): Promise<void> {
    this.opened = false
  }
  async sendReport(_reportId: number, data: BufferSource): Promise<void> {
    const response = new Uint8Array(data as ArrayBuffer).slice()
    response[0] = 0xff
    setTimeout(() => {
      const event = new Event('inputreport')
      Object.defineProperty(event, 'data', { value: new DataView(response.buffer) })
      Object.defineProperty(event, 'reportId', { value: 0 })
      this.dispatchEvent(event)
    }, 1)
  }
}
