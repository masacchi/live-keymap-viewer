/**
 * 同じキーボードが複数のインターフェースで見えているとき、実際に答えるものを選ぶ。
 *
 * Cornix LPはUSBとBluetoothの両方で接続していると、Windows上にVial用の
 * インターフェース(usagePage 0xFF60)が2つ現れる。VID/PIDは同じなので見分けが付かず、
 * 先頭のものを選ぶと、出力先でない側は何も答えずに「デバイスが応答しない」になる。
 *
 * そこで各候補に`[0xFE, 0x00]`(キーボードIDの問い合わせ)を送って確認する。
 * このコマンドはアンロック進行中でも必ず答える(docs/PROTOCOL.md §2)。
 * 答えたもののうち一番速いものを使うので、両方答える場合はUSB(往復数ms)が
 * BLE(十数〜数十ms)より優先される。
 */
import { CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID } from './constants'
import { WebHidTransport } from './transport'

/**
 * 1候補あたりの待ち時間。答えない候補にかかる時間は最大これ × PROBE_RETRIES。
 * Bluetoothの往復(450ms前後)はこれより長いが、1回目の応答が遅れて届いた時点でWebHidTransportが
 * 往復時間を覚え、送り直した方の期限を延ばすので、答えるものとして選べる。
 */
const PROBE_TIMEOUT_MS = 300
const PROBE_RETRIES = 2

export interface ProbeResult {
  device: HIDDevice
  /** 往復にかかった時間(ms)。答えなければnull。 */
  latencyMs: number | null
}

/** 1台に問い合わせて、答えるかどうかと往復時間を返す。確認したら閉じる。 */
export async function probeDevice(
  device: HIDDevice,
  now: () => number = () => performance.now()
): Promise<ProbeResult> {
  const transport = new WebHidTransport(device)
  try {
    await transport.open()
    const started = now()
    await transport.send(new Uint8Array([CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID]), {
      timeoutMs: PROBE_TIMEOUT_MS,
      retries: PROBE_RETRIES
    })
    return { device, latencyMs: now() - started }
  } catch {
    return { device, latencyMs: null }
  } finally {
    await transport.close().catch(() => undefined)
  }
}

/**
 * 候補の中から、答えるもののうち一番速いものを選ぶ。どれも答えなければnull。
 * 候補が1つなら確認せずにそれを返す(答えなければ接続時のエラーで分かる)。
 */
export async function pickResponsiveDevice(
  candidates: readonly HIDDevice[],
  probe: (device: HIDDevice) => Promise<ProbeResult> = (device) => probeDevice(device)
): Promise<{ device: HIDDevice | null; results: ProbeResult[] }> {
  if (candidates.length <= 1) return { device: candidates[0] ?? null, results: [] }

  // 同じHIDを同時に開くと応答が混ざるので、1つずつ確認する
  const results: ProbeResult[] = []
  for (const candidate of candidates) results.push(await probe(candidate))

  const responsive = results
    .filter((r): r is ProbeResult & { latencyMs: number } => r.latencyMs !== null)
    .sort((a, b) => a.latencyMs - b.latencyMs)
  return { device: responsive[0]?.device ?? null, results }
}
