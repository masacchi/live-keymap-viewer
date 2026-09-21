/**
 * 同じキーボードが複数のインターフェースで見えているとき、実際に答えるものを選ぶ。
 *
 * Cornix LP は USB と Bluetooth の両方で繋がっていると、Windows 上に Vial 用の
 * インターフェース(usagePage 0xFF60)が 2 つ現れる。VID/PID は同じなので見分けが付かず、
 * 先頭のものを掴むと、出力先でない側は何も答えずに「デバイスが応答しない」になる。
 *
 * そこで各候補に `[0xFE, 0x00]`(キーボード ID の問い合わせ)を投げて確かめる。
 * このコマンドはアンロック進行中でも必ず答える(docs/PROTOCOL.md §2)。
 * 答えたもののうち一番速いものを使うので、両方答える場合は USB(往復数 ms)が
 * BLE(十数〜数十 ms)より優先される。
 */
import { CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID } from './constants'
import { WebHidTransport } from './transport'

/** 1 候補あたりの待ち時間。答えない候補にかかる時間は最大これ × PROBE_RETRIES。 */
const PROBE_TIMEOUT_MS = 300
const PROBE_RETRIES = 2

export interface ProbeResult {
  device: HIDDevice
  /** 往復にかかった時間(ms)。答えなければ null。 */
  latencyMs: number | null
}

/** 1 台に問い合わせて、答えるかどうかと往復時間を返す。確かめたら閉じる。 */
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
 * 候補の中から、答えるもののうち一番速いものを選ぶ。どれも答えなければ null。
 * 候補が 1 つなら確かめずにそれを返す(従来どおり。答えなければ接続時のエラーで分かる)。
 */
export async function pickResponsiveDevice(
  candidates: readonly HIDDevice[],
  probe: (device: HIDDevice) => Promise<ProbeResult> = (device) => probeDevice(device)
): Promise<{ device: HIDDevice | null; results: ProbeResult[] }> {
  if (candidates.length <= 1) return { device: candidates[0] ?? null, results: [] }

  // 同じ HID を同時に開くと応答が混ざるので、1 つずつ確かめる
  const results: ProbeResult[] = []
  for (const candidate of candidates) results.push(await probe(candidate))

  const responsive = results
    .filter((r): r is ProbeResult & { latencyMs: number } => r.latencyMs !== null)
    .sort((a, b) => a.latencyMs - b.latencyMs)
  return { device: responsive[0]?.device ?? null, results }
}
