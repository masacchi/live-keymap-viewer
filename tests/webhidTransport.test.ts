/**
 * 実機と同じ経路(WebHidTransport)を通した結合テスト。
 *
 * ほかのテストはMockTransportを直接使うので、WebHIDのイベント配送・直列化キュー・
 * 応答の照合という「本物のデバイスで通る経路」を素通りしている。ここでは
 * MockTransportのファーム模擬を裏に持つ偽のHIDDeviceを作り、WebHidTransport越しに動かす。
 */
import { describe, expect, it } from 'vitest'
import { pickResponsiveDevice } from '@/hid/deviceProbe'
import { WebHidTransport } from '@/hid/transport'
import { getMatrixState, loadKeyboard } from '@/hid/vial'
import { KeyboardSession, type SessionState } from '@/session/keyboardSession'
import { asHid, FirmwareBackedDevice, SilentDevice, ViaOnlyDevice } from './fixtures/fakeHid'

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

describe('WebHidTransport越しの結合', () => {
  it('キーボードを最後まで読み込める', async () => {
    const device = new FirmwareBackedDevice(true)
    const transport = new WebHidTransport(asHid(device))
    await transport.open()
    const snapshot = await loadKeyboard(transport)
    expect(snapshot.layers).toBe(10)
    expect(snapshot.definition.matrix).toEqual({ rows: 8, cols: 7 })
    await transport.close()
  }, 15000)

  it('ロックされた実機でも、アンロックしてポーリングまで進む', async () => {
    const device = new FirmwareBackedDevice(false)
    const session = new KeyboardSession(new WebHidTransport(asHid(device)), {
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

  it('接続し直しても(同じHIDDeviceを新しいセッションで開き直しても)応答が返る', async () => {
    const device = new FirmwareBackedDevice(true)
    const first = new KeyboardSession(new WebHidTransport(asHid(device)))
    await first.start()
    await waitFor(first, (s) => s.status === 'ready')

    // フックのattachと同じ順: 新しいセッションを作る → 古いものを破棄 → 新しいものを開始
    const second = new KeyboardSession(new WebHidTransport(asHid(device)))
    await first.dispose()
    await second.start()
    const state = await waitFor(second, (s) => s.status === 'ready' || s.status === 'error')
    expect(state.error).toBeNull()
    expect(state.status).toBe('ready')
    await second.dispose()
  }, 15000)
})

describe('答えるインターフェースを選ぶ(USBとBluetoothの両方で見えているとき)', () => {
  it('答えない方を先頭に並べても、答える方を選ぶ', async () => {
    const silent = new SilentDevice()
    const live = new FirmwareBackedDevice(true)
    const { device, results } = await pickResponsiveDevice([asHid(silent), asHid(live)])
    expect(device).toBe(live)
    expect(results.map((r) => r.latencyMs === null)).toEqual([true, false])
    // 確認したあとは閉じてある(このあとセッションが開き直す)
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

  it('答えてもVialでない機器(VIAだけのもの)は選ばない', async () => {
    const viaOnly = new ViaOnlyDevice()
    const live = new FirmwareBackedDevice(true)
    const picked = await pickResponsiveDevice([asHid(viaOnly), asHid(live)])
    expect(picked.device).toBe(live)

    // Vialでない機器しか答えなければnull。答えたことは結果に残す(接続の側が文言を選ぶ)
    const { device, results } = await pickResponsiveDevice([
      asHid(new ViaOnlyDevice()),
      asHid(new SilentDevice())
    ])
    expect(device).toBeNull()
    expect(results.map(({ latencyMs, vial }) => [latencyMs !== null, vial])).toEqual([
      [true, false],
      [false, false]
    ])
  })

  it('どれも答えなければnull', async () => {
    const { device, results } = await pickResponsiveDevice([
      asHid(new SilentDevice()),
      asHid(new SilentDevice())
    ])
    expect(device).toBeNull()
    expect(results).toHaveLength(2)
  })

  it('候補が1つなら確かめずにそれを返す(余計な待ちを作らない)', async () => {
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
    ).rejects.toThrow('デバイスが応答しません(コマンド0x02 0x03)')
    await expect(
      transport.send(new Uint8Array([0x01]), { timeoutMs: 10, retries: 1 })
    ).rejects.toThrow('(コマンド0x01)')
  })
})

/**
 * タイムアウトで諦めた要求への応答が、遅れて届いたときの扱い(docs/BLUETOOTH.md §3)。
 * RMKのBLEはスレーブレイテンシ30なので往復が最悪240msほどかかり、matrixのタイムアウト(200ms)で
 * 再送が起きる。遅れて届いた応答をそのまま受け取ると、押下が1回ずれる。
 */
describe('時間切れのあとの取り違え(docs/BLUETOOTH.md P3(b))', () => {
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  it('遅れて届いた応答は捨て、投げ直した方の応答を受け取る', async () => {
    // ファームは応答に要求IDを持たない。諦めた要求への応答をそのまま受け取ると、
    // 同じコマンドなので照合も通ってしまい、以後ずっと1回ずつずれる
    const device = new FirmwareBackedDevice(true)
    device.latencyMs = 20
    const transport = new WebHidTransport(asHid(device))
    await transport.open()

    device.stallNextMs = 300 // 1往復目だけ、matrixのタイムアウト(200ms)を超えて詰まる
    // 投げ直すまでのあいだに押す。諦めた応答を受け取ると「離している」に見える
    setTimeout(() => device.firmware.press(0, 1), 100)

    const matrix = await getMatrixState(transport, 8, 7)
    expect(matrix[0][1]).toBe(true)
    await transport.close()
  }, 10000)

  it('応答ごと失われても、しばらくすれば元に戻る', async () => {
    const device = new FirmwareBackedDevice(true)
    const transport = new WebHidTransport(asHid(device), { staleWindowMs: 20 })
    await transport.open()

    // 1往復ぶん、応答が返ってこない。次の応答は「遅れて届いた前の応答」と取り違えて捨てるので、
    // この呼び出しは失敗し、往復も長く見積もる(タイムアウトが延びるぶん、このテストは2秒ほどかかる)
    device.dropNext = 1
    await getMatrixState(transport, 8, 7).catch(() => undefined)

    await pause(40) // 窓を過ぎれば、諦めた数は数え直す
    const matrix = await getMatrixState(transport, 8, 7)
    expect(matrix[0][1]).toBe(false)
    await transport.close()
  }, 10000)
})
