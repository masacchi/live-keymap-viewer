/**
 * Tap Dance と「長押しで出るレイヤー」の解釈。
 *
 * レイヤー判定(engine)と描画(KeyboardView の色帯)の両方が同じ規則を使うので、
 * ここに 1 つだけ置く。HID 層には依存しない。
 */
import { decodeKeycode, type Keycode } from './decode'

/** Vial の Tap Dance エントリ 1 個(`vial.h` の vial_tap_dance_entry_t)。 */
export interface TapDanceEntry {
  onTap: number
  onHold: number
  onDoubleTap: number
  onTapHold: number
  /** ms。0 のときは既定の tapping term を使う。 */
  tappingTerm: number
}

/**
 * このキーコードを長押ししたときに出るレイヤー。出さないなら null。
 *
 * 対象は HANDOFF §6 の MVP 範囲:
 *   - `MO(n)`
 *   - `LT(n, kc)`
 *   - on_hold が `MO(n)` の Tap Dance
 */
export function holdLayerOf(
  keycode: Keycode,
  tapDance: ReadonlyArray<Pick<TapDanceEntry, 'onHold'>>
): number | null {
  if (keycode.kind === 'layerTap') return keycode.layer
  if (keycode.kind === 'layer' && keycode.op === 'MO') return keycode.layer
  if (keycode.kind === 'tapDance') {
    const entry = tapDance[keycode.index]
    if (!entry) return null
    const hold = decodeKeycode(entry.onHold)
    if (hold.kind === 'layer' && hold.op === 'MO') return hold.layer
  }
  return null
}

/** このキーコードの tapping term(ms)。Tap Dance はエントリごとの値を優先する。 */
export function tappingTermOf(
  keycode: Keycode,
  tapDance: ReadonlyArray<Pick<TapDanceEntry, 'tappingTerm'>>,
  fallback: number
): number {
  if (keycode.kind === 'tapDance') {
    const entry = tapDance[keycode.index]
    if (entry && entry.tappingTerm > 0) return entry.tappingTerm
  }
  return fallback
}
