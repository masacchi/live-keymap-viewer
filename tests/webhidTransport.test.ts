/**
 * 実機と同じ経路(WebHidTransport)を通した結合テスト。
 *
 * ほかのテストは MockTransport を直接使うので、WebHID のイベント配送・直列化キュー・
 * 応答の照合という「本物のデバイスで通る経路」を素通りしている。ここでは
 * MockTransport のファーム模擬を裏に持つ偽の HIDDevice を作り、WebHidTransport 越しに動かす。
 */
import { describe, expect, it } from 'vitest'
import { pickResponsiveDevice } from '@/hid/deviceProbe'
import { MockTransport } from '@/hid/mockTransport'
import { WebHidTransport } from '@/hid/transport'
import { getMatrixState, loadKeyboard } from '@/hid/vial'
import { KeyboardSession, type SessionState } from '@/session/keyboardSession'

/** sendReport を受けると、ファーム模擬の応答を inputreport として返す偽デバイス。 */
class FirmwareBackedDevice extends EventTarget {
  opened = false
  productName = 'Cornix (fake HID)'
  collections = [{ usagePage: 0xff60, usage: 0x61 }]
  readonly firmware: MockTransport
  /** 応答を返すまでの遅れ(ms)。 */
  latencyMs = 1

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
    setTimeout(() => {
      const event = new Event('inputreport')
      Object.defineProperty(event, 'data', { value: new DataView(response.slice().buffer) })
      Object.defineProperty(event, 'reportId', { value: 0 })
      this.dispatchEvent(event)
    }, this.latencyMs)
  }
}

function waitFor(
  session: KeyboardSession,
  predicate: (s: SessionState) => boolean,
  timeoutMs = 8000
): Promise<SessionState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`待ちきれなかった: ${session.state.status} ${session.state.error ?? ''}`)),
      timeoutMs
    )
    const off = session.subscribe((s) => {
      if (!predicate(s)) return
      clearTimeout(timer)
      queueMicrotask(() => off())
      resolve(s)
    })
  })
}

describe('WebHidTransport 越しの結合', () => {
  it('キーボードを最後まで読み込める', async () => {
    const device = new FirmwareBackedDevice(true)
    const transport = new WebHidTransport(device as unknown as HIDDevice)
    await transport.open()
    const snapshot = await loadKeyboard(transport)
    expect(snapshot.layers).toBe(10)
    expect(snapshot.definition.matrix).toEqual({ rows: 8, cols: 7 })
    await transport.close()
  }, 15000)

  it('ロックされた実機でも、アンロックしてポーリングまで進む', async () => {
    const device = new FirmwareBackedDevice(false)
    const session = new KeyboardSession(new WebHidTransport(device as unknown as HIDDevice), {
      unlockPollMs: 5
    })
    await session.start()
    await waitFor(session, (s) => s.status === 'unlocking')
    device.firmware.press(0, 0)
    device.firmware.press(0, 1)
    await waitFor(session, (s) => s.status === 'ready')

    device.firmware.release(0, 0)
    device.firmware.release(0, 1)
    device.firmware.press(0, 1)
    const state = await waitFor(session, (s) => s.layers?.held.has('0,1') === true)
    expect(state.error).toBeNull()
    await session.dispose()
  }, 15000)

  it('接続し直しても(同じ HIDDevice を新しいセッションで開き直しても)応答が返る', async () => {
    const device = new FirmwareBackedDevice(true)
    const first = new KeyboardSession(new WebHidTransport(device as unknown as HIDDevice))
    await first.start()
    await waitFor(first, (s) => s.status === 'ready')

    // フックの attach と同じ順: 新しいセッションを作る → 古いものを破棄 → 新しいものを開始
    const second = new KeyboardSession(new WebHidTransport(device as unknown as HIDDevice))
    await first.dispose()
    await second.start()
    const state = await waitFor(second, (s) => s.status === 'ready' || s.status === 'error')
    expect(state.error).toBeNull()
    expect(state.status).toBe('ready')
    await second.dispose()
  }, 15000)
})

/** 何を送っても答えない偽デバイス(出力先でない側の Bluetooth インターフェースのような)。 */
class SilentDevice extends EventTarget {
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

describe('答えるインターフェースを選ぶ(USB と Bluetooth の両方で見えているとき)', () => {
  const asHid = (d: EventTarget): HIDDevice => d as unknown as HIDDevice

  it('答えない方を先頭に並べても、答える方を選ぶ', async () => {
    const silent = new SilentDevice()
    const live = new FirmwareBackedDevice(true)
    const { device, results } = await pickResponsiveDevice([asHid(silent), asHid(live)])
    expect(device).toBe(live)
    expect(results.map((r) => r.latencyMs === null)).toEqual([true, false])
    // 確かめたあとは閉じてある(このあとセッションが開き直す)
    expect(silent.opened).toBe(false)
    expect(live.opened).toBe(false)
  })

  it('両方答えるなら、速い方(USB)を選ぶ', async () => {
    const bluetooth = new FirmwareBackedDevice(true)
    bluetooth.latencyMs = 40
    const usb = new FirmwareBackedDevice(true)
    usb.latencyMs = 1
    const { device } = await pickResponsiveDevice([asHid(bluetooth), asHid(usb)])
    expect(device).toBe(usb)
  })

  it('どれも答えなければ null', async () => {
    const { device, results } = await pickResponsiveDevice([
      asHid(new SilentDevice()),
      asHid(new SilentDevice())
    ])
    expect(device).toBeNull()
    expect(results).toHaveLength(2)
  })

  it('候補が 1 つなら確かめずにそれを返す(余計な待ちを作らない)', async () => {
    const only = new SilentDevice()
    const { device, results } = await pickResponsiveDevice([asHid(only)])
    expect(device).toBe(only)
    expect(results).toEqual([])
  })

  it('選んだものでそのまま読み込める', async () => {
    const live = new FirmwareBackedDevice(true)
    const { device } = await pickResponsiveDevice([asHid(new SilentDevice()), asHid(live)])
    const session = new KeyboardSession(new WebHidTransport(device as HIDDevice))
    await session.start()
    const state = await waitFor(session, (s) => s.status === 'ready' || s.status === 'error')
    expect(state.status).toBe('ready')
    await session.dispose()
  }, 15000)
})

describe('時間切れのメッセージ', () => {
  it('どのコマンドで止まったかを含める', async () => {
    const transport = new WebHidTransport(new SilentDevice() as unknown as HIDDevice)
    await transport.open()
    await expect(
      transport.send(new Uint8Array([0x02, 0x03]), { timeoutMs: 10, retries: 1 })
    ).rejects.toThrow('デバイスが応答しない(コマンド 0x02 0x03)')
    await expect(
      transport.send(new Uint8Array([0x01]), { timeoutMs: 10, retries: 1 })
    ).rejects.toThrow('(コマンド 0x01)')
  })
})

/**
 * docs/BLUETOOTH.md §3 の再現。RMK の BLE はスレーブレイテンシ 30 なので、往復が
 * 最悪 240ms ほどかかる。今は matrix の時間切れ(200ms)で再送し、遅れて届いた応答が
 * 次の回の応答として受け取られて、押下が 1 回ずれる。
 *
 * TODO(BLUETOOTH.md P2): 往復に合わせた時間切れと、取り残された応答の破棄を実装したら
 * `it.skip` を `it` に戻す。これが通れば P2 は完了。
 */
describe('BLE 並みの遅さ(docs/BLUETOOTH.md §3)', () => {
  it.skip('BLE 並みの往復でも、押したキーを正しい回に読む', async () => {
    const device = new FirmwareBackedDevice(true)
    device.latencyMs = 250
    const transport = new WebHidTransport(device as unknown as HIDDevice)
    await transport.open()

    // 3 回目の直前だけキーを押しておく。正しければ 3 回目だけが true
    const seen: boolean[] = []
    for (let i = 0; i < 4; i++) {
      if (i === 2) device.firmware.press(0, 1)
      else device.firmware.release(0, 1)
      const matrix = await getMatrixState(transport, 8, 7)
      seen.push(matrix[0][1])
    }
    expect(seen).toEqual([false, false, true, false])
    await transport.close()
  }, 20000)
})
