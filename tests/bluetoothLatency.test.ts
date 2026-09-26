/**
 * Bluetoothの遅さ(往復450ms前後)でも読めるか(docs/BLUETOOTH.md §3・P3)。
 *
 * 本物の時間で待つので数秒かかる。webhidTransport.test.tsと分けてあるのは、vitestがファイルごとに
 * 並べて走らせるため(1つのファイルにまとめると、コミットのたびの検査がその分延びる)。
 */
import { describe, it } from 'vitest'
import { pickResponsiveDevice } from '@/hid/deviceProbe'
import { WebHidTransport } from '@/hid/transport'
import { getMatrixState } from '@/hid/vial'
import { asHid, FirmwareBackedDevice, SilentDevice } from './fixtures/fakeHid'

/**
 * 往復そのものがタイムアウトより長いとき(docs/BLUETOOTH.md §3)。WebHidTransportが往復時間を覚えて
 * タイムアウトを延ばす(P3(a))ので、送り直しが起きず、押したキーを正しい回に読める。
 * 実測の往復は444〜488ms(§2.6)。
 */
// 互いに待たせないよう、テストも並べて走らせる。
// 並べるときは、どのテストの失敗かを取り違えないよう、テストごとのexpectを使う
describe.concurrent('BLE並みの遅さ(docs/BLUETOOTH.md §3)', () => {
  it.for([250, 500])(
    '往復%imsでも、押したキーを正しい回に読む',
    { timeout: 20000 },
    async (latencyMs, { expect }) => {
      const device = new FirmwareBackedDevice(true)
      device.latencyMs = latencyMs
      const transport = new WebHidTransport(asHid(device))
      await transport.open()

      // 3回目の直前だけキーを押しておく。正しければ3回目だけがtrue
      const seen: boolean[] = []
      for (let i = 0; i < 4; i++) {
        if (i === 2) device.firmware.press(0, 1)
        else device.firmware.release(0, 1)
        const matrix = await getMatrixState(transport, 8, 7)
        seen.push(matrix[0][1])
      }
      expect(seen).toEqual([false, false, true, false])
      // 覚えた往復時間でタイムアウトが延びている(matrixの200msのままではない)
      expect(transport.timeoutFor(200)).toBeGreaterThanOrEqual(latencyMs * 2)
      await transport.close()
    }
  )

  it('USB並みの往復では、タイムアウトは呼び出し側の値のまま', async ({ expect }) => {
    const device = new FirmwareBackedDevice(true)
    const transport = new WebHidTransport(asHid(device))
    await transport.open()
    await getMatrixState(transport, 8, 7)
    expect(transport.roundTripMs).not.toBeNull()
    expect(transport.timeoutFor(200)).toBe(200)
    await transport.close()
  })

  it('答えないデバイスでは、待つ時間を延ばさない', async ({ expect }) => {
    const device = new FirmwareBackedDevice(true)
    device.dropNext = 3
    const transport = new WebHidTransport(asHid(device))
    await transport.open()
    const started = performance.now()
    await expect(getMatrixState(transport, 8, 7)).rejects.toThrow('応答しません')
    // 200ms × 3回。往復時間が分からないので延ばさない
    expect(performance.now() - started).toBeLessThan(900)
    expect(transport.roundTripMs).toBeNull()
    await transport.close()
  })

  it('往復が延びたあと速く戻れば、タイムアウトも少しずつ戻る', async ({ expect }) => {
    const device = new FirmwareBackedDevice(true)
    const transport = new WebHidTransport(asHid(device))
    await transport.open()
    device.stallNextMs = 400 // 1回だけ詰まる
    await getMatrixState(transport, 8, 7)
    const stretched = transport.timeoutFor(200)
    expect(stretched).toBeGreaterThan(200)
    for (let i = 0; i < 60; i++) await getMatrixState(transport, 8, 7)
    expect(transport.timeoutFor(200)).toBe(200)
    await transport.close()
  }, 20000)

  it('Bluetoothの往復(1回の待ちより長い)でも、答えるものとして選ぶ', async ({ expect }) => {
    // BTのCornixとVialでない機器(Keychron Linkなど)が並ぶ場面。往復470msは確認の待ち(300ms)より長いが、
    // 遅れて届いた応答で往復時間を覚え、送り直した方の期限を延ばして間に合わせる
    const silent = new SilentDevice()
    const bluetooth = new FirmwareBackedDevice(true)
    bluetooth.latencyMs = 470
    const { device } = await pickResponsiveDevice([asHid(silent), asHid(bluetooth)])
    expect(device).toBe(bluetooth)
  }, 10000)
})
