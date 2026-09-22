/**
 * Vial protocol 6 の生キーコード (u16) を構造体に落とす。
 *
 * 範囲の根拠は docs/PROTOCOL.md §5(vial-gui の keycodes_v6.py を確認したもの)。
 */
import { KEYCODE_MASKS, KEYCODE_NAMES } from './table.generated'

export const QK_MODS = 0x0100
export const QK_MOD_TAP = 0x2000
export const QK_LAYER_TAP = 0x4000
export const QK_LAYER_MOD = 0x5000
export const QK_TO = 0x5200
export const QK_MOMENTARY = 0x5220
export const QK_DEF_LAYER = 0x5240
export const QK_TOGGLE_LAYER = 0x5260
export const QK_ONE_SHOT_LAYER = 0x5280
export const QK_ONE_SHOT_MOD = 0x52a0
export const QK_LAYER_TAP_TOGGLE = 0x52c0
export const QK_PERSISTENT_DEF_LAYER = 0x52e0
export const QK_TAP_DANCE = 0x5700
export const QK_MACRO = 0x7700
export const QK_KB = 0x7e00

export const KC_NO = 0x0000
export const KC_TRNS = 0x0001

export const MOD_CTRL = 0x01
export const MOD_SHIFT = 0x02
export const MOD_ALT = 0x04
export const MOD_GUI = 0x08
/** 立っていれば右側のモディファイア。 */
export const MOD_RIGHT = 0x10

/** 一段だけ内側を持てるレイヤー系の操作。 */
export type LayerOp = 'TO' | 'MO' | 'DF' | 'TG' | 'OSL' | 'TT' | 'PDF'

export type Keycode =
  | { kind: 'none'; raw: number }
  | { kind: 'trns'; raw: number }
  /** 名前テーブルで引けた単独キーコード(基本キー、メディア、QK_BOOT など)。 */
  | { kind: 'basic'; raw: number; name: string }
  /** モディファイア付きキー。例: LSFT(KC_1) */
  | { kind: 'mods'; raw: number; mods: number; inner: Keycode }
  /** Mod-Tap。例: LCTL_T(KC_A) */
  | { kind: 'modTap'; raw: number; mods: number; inner: Keycode }
  /** Layer-Tap。例: LT2(KC_SPACE) */
  | { kind: 'layerTap'; raw: number; layer: number; inner: Keycode }
  /** LM(layer, mod) */
  | { kind: 'layerMod'; raw: number; layer: number; mods: number }
  | { kind: 'layer'; raw: number; op: LayerOp; layer: number }
  | { kind: 'oneShotMod'; raw: number; mods: number }
  | { kind: 'tapDance'; raw: number; index: number }
  | { kind: 'macro'; raw: number; index: number }
  /** customKeycodes[index] に対応する USER キーコード。 */
  | { kind: 'user'; raw: number; index: number }
  | { kind: 'unknown'; raw: number }

function basic(raw: number): Keycode {
  const name = KEYCODE_NAMES[raw]
  if (name === undefined) return { kind: 'unknown', raw }
  return { kind: 'basic', raw, name }
}

/**
 * 生のキーコードを構造体に変換する。
 *
 * 判定順は QMK の範囲割り当てどおり。名前テーブルは、構造的に解釈できない値にだけ使う。
 */
export function decodeKeycode(raw: number): Keycode {
  const code = raw & 0xffff

  if (code === KC_NO) return { kind: 'none', raw: code }
  if (code === KC_TRNS) return { kind: 'trns', raw: code }
  if (code < 0x0100) return basic(code)

  if (code < QK_MOD_TAP) {
    return { kind: 'mods', raw: code, mods: (code >> 8) & 0x1f, inner: basic(code & 0xff) }
  }
  if (code < QK_LAYER_TAP) {
    return { kind: 'modTap', raw: code, mods: (code >> 8) & 0x1f, inner: basic(code & 0xff) }
  }
  if (code < QK_LAYER_MOD) {
    return { kind: 'layerTap', raw: code, layer: (code >> 8) & 0x0f, inner: basic(code & 0xff) }
  }
  if (code < QK_TO) {
    return { kind: 'layerMod', raw: code, layer: (code >> 5) & 0x0f, mods: code & 0x1f }
  }
  if (code < QK_TAP_DANCE) {
    const op = LAYER_OPS.find((o) => code >= o.base && code < o.base + 32)
    if (op) return { kind: 'layer', raw: code, op: op.op, layer: code - op.base }
    if (code >= QK_ONE_SHOT_MOD && code < QK_ONE_SHOT_MOD + 32) {
      return { kind: 'oneShotMod', raw: code, mods: code & 0x1f }
    }
    return basic(code)
  }
  if (code < QK_TAP_DANCE + 256) {
    return { kind: 'tapDance', raw: code, index: code - QK_TAP_DANCE }
  }
  if (code >= QK_MACRO && code < QK_MACRO + 256) {
    return { kind: 'macro', raw: code, index: code - QK_MACRO }
  }
  if (code >= QK_KB && code < QK_KB + 64) {
    return { kind: 'user', raw: code, index: code - QK_KB }
  }
  return basic(code)
}

const LAYER_OPS: ReadonlyArray<{ base: number; op: LayerOp }> = [
  { base: QK_TO, op: 'TO' },
  { base: QK_MOMENTARY, op: 'MO' },
  { base: QK_DEF_LAYER, op: 'DF' },
  { base: QK_TOGGLE_LAYER, op: 'TG' },
  { base: QK_ONE_SHOT_LAYER, op: 'OSL' },
  { base: QK_LAYER_TAP_TOGGLE, op: 'TT' },
  { base: QK_PERSISTENT_DEF_LAYER, op: 'PDF' }
]

/**
 * モディファイアのビット集合を Vial / QMK の表記に戻す。例: 0x02 -> "LSFT"
 *
 * `base` に QK_MOD_TAP を渡すと Mod-Tap 側の名前(LSFT_T など)になる。
 */
export function formatMods(mods: number, base = 0): string {
  const named = KEYCODE_MASKS[base | ((mods & 0x1f) << 8)]
  if (named !== undefined) return named
  return `0x${(base | ((mods & 0x1f) << 8)).toString(16)}`
}

/**
 * 構造体を Vial の .vil と同じ文字列表記に戻す。テストと画面のツールチップ用。
 */
export function formatKeycode(kc: Keycode): string {
  switch (kc.kind) {
    case 'none':
      return 'KC_NO'
    case 'trns':
      return 'KC_TRNS'
    case 'basic':
      return kc.name
    case 'mods':
      return `${formatMods(kc.mods)}(${formatKeycode(kc.inner)})`
    case 'modTap':
      return `${formatMods(kc.mods, QK_MOD_TAP)}(${formatKeycode(kc.inner)})`
    case 'layerTap':
      return `LT${kc.layer}(${formatKeycode(kc.inner)})`
    case 'layerMod':
      return `LM(${kc.layer},${formatMods(kc.mods)})`
    case 'layer':
      return `${kc.op}(${kc.layer})`
    case 'oneShotMod':
      return `OSM(${formatMods(kc.mods)})`
    case 'tapDance':
      return `TD(${kc.index})`
    case 'macro':
      return `M${kc.index}`
    case 'user':
      return `USER${String(kc.index).padStart(2, '0')}`
    case 'unknown':
      return `0x${kc.raw.toString(16)}`
  }
}

/** Shift が含まれているか。JIS ラベルの Shift 面を出すのに使う。 */
export function hasShift(mods: number): boolean {
  return (mods & MOD_SHIFT) !== 0
}

/**
 * 単独のモディファイアキー(KC_LCTL〜KC_RGUI、0xE0〜0xE7)なら、その MOD_* ビット。違えば 0。
 * 左右は区別しない(MOD_RIGHT は立てない)。
 */
export function modifierBitsOf(keycode: Keycode): number {
  if (keycode.kind !== 'basic' || keycode.raw < 0xe0 || keycode.raw > 0xe7) return 0
  return 1 << ((keycode.raw - 0xe0) & 3) // Ctrl, Shift, Alt, GUI の順に並んでいる
}
