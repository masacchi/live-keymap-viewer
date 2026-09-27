/**
 * Tap Danceと「長押しで出るレイヤー」の解釈。
 *
 * レイヤー判定(engine)と描画(KeyboardViewの色帯)の両方が同じ規則を使うので、
 * ここに1つだけ置く。HID層には依存しない。
 */
import { decodeKeycode, type Keycode, MOD_RIGHT, modifierBitsOf } from './decode'

/** VialのTap Danceエントリ1個(`vial.h`のvial_tap_dance_entry_t)。 */
export interface TapDanceEntry {
  onTap: number
  onHold: number
  onDoubleTap: number
  onTapHold: number
  /** ms。0のときは既定のtapping termを使う。 */
  tappingTerm: number
}

/**
 * 長押し(LT / MT / Tap Danceのhold)をいつ確定させるか。キーボードの設定に合わせる
 * (QMK設定のPermissive Hold / Hold On Other Key Press。RMKも同じ番号。hid/vial.tsのgetHoldMode。判定はengine/layerState.ts)。
 *
 * - `hold-on-other-key-press`: 押しているあいだに別のキーを**押した**瞬間に長押し
 * - `permissive-hold`: 押しているあいだに別のキーを**押して離した**ら長押し
 * - `tapping-term`: 時間だけで決める。その前に離せばタップ
 *
 * どちらでもないときは、キーボードは長押しかタップかが決まるまで、後に押したキーを出さずに待つ。
 * エンジンも、そのキーを保留(`HeldKey.pending`)にして、決まってからどのレイヤーのキーかを決め直す。
 */
export type HoldMode = 'hold-on-other-key-press' | 'permissive-hold' | 'tapping-term'

/**
 * このキーコードを長押ししたときに出るレイヤー。出さないならnull。
 *
 * 対象:
 *   - `MO(n)`
 *   - `LT(n, kc)`
 *   - on_holdが`MO(n)`のTap Dance
 */
export function holdLayerOf(
  keycode: Keycode,
  tapDance: ReadonlyArray<Pick<TapDanceEntry, 'onHold'> | undefined>
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

/**
 * このキーコードを長押ししたときに効くモディファイア(MOD_*ビット、左右は区別しない)。無ければ0。
 *
 *   - `MT(mod, kc)`(`LSFT_T(KC_A)`など)
 *   - on_holdが単独のモディファイアキーのTap Dance
 */
export function holdModsOf(
  keycode: Keycode,
  tapDance: ReadonlyArray<Pick<TapDanceEntry, 'onHold'> | undefined>
): number {
  if (keycode.kind === 'modTap') return keycode.mods & ~MOD_RIGHT
  if (keycode.kind === 'tapDance') {
    const entry = tapDance[keycode.index]
    if (entry) return modifierBitsOf(decodeKeycode(entry.onHold))
  }
  return 0
}

/** このキーコードのtapping term(ms)。Tap Danceはエントリごとの値を優先する。 */
export function tappingTermOf(
  keycode: Keycode,
  tapDance: ReadonlyArray<Pick<TapDanceEntry, 'tappingTerm'> | undefined>,
  fallback: number
): number {
  if (keycode.kind === 'tapDance') {
    const entry = tapDance[keycode.index]
    if (entry && entry.tappingTerm > 0) return entry.tappingTerm
  }
  return fallback
}
