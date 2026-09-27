/**
 * Vialの動的な設定のうち、マクロとコンボ。キーの説明(ツールチップ)やPDFに中身を出すのに使う。
 *
 * マクロはVIAのマクロ領域(NULで区切った並び)に、Vialの形式(vial protocol 2以降)で入っている
 * (vial-guiの`protocol/macro.py`の`macro_deserialize_v2`)。RMKも同じ形式で持つ。
 *
 *   ふつうのバイト        … その文字を打つ(SEND_STRINGの文字。ASCII)
 *   0x01 0x01 kc         … kcをタップ(1バイトのキーコード)
 *   0x01 0x02 kc / 0x03  … kcを押す / 離す
 *   0x01 0x04 d1 d2      … (d1 - 1) + (d2 - 1) * 255 ms待つ
 *   0x01 0x05..0x07 lo hi … 0x01..0x03と同じで、キーコードが2バイト(u16 LE)
 */

export type MacroAction =
  | { kind: 'text'; text: string }
  | { kind: 'tap' | 'down' | 'up'; keycodes: number[] }
  | { kind: 'delay'; ms: number }

/** コンボ。押すキー(0は使わない枠なので除く)と、出るキー。 */
export interface ComboEntry {
  /** キーボードの中の番号。 */
  index: number
  keys: number[]
  output: number
}

const SS_QMK_PREFIX = 0x01
const SS_TAP = 0x01
const SS_DOWN = 0x02
const SS_UP = 0x03
const SS_DELAY = 0x04
const EXT_TAP = 0x05
const EXT_UP = 0x07

const KIND = { [SS_TAP]: 'tap', [SS_DOWN]: 'down', [SS_UP]: 'up' } as const

/** 1つのマクロをほどく。続けて同じ種類の操作が並べば1つにまとめる(vial-guiと同じ)。 */
export function decodeMacro(data: Uint8Array): MacroAction[] {
  const out: MacroAction[] = []
  let i = 0
  const push = (kind: 'tap' | 'down' | 'up', keycode: number): void => {
    const last = out.at(-1)
    if (last && last.kind === kind) last.keycodes.push(keycode)
    else out.push({ kind, keycodes: [keycode] })
  }
  while (i < data.length) {
    if (data[i] !== SS_QMK_PREFIX) {
      const ch = String.fromCharCode(data[i])
      const last = out.at(-1)
      if (last?.kind === 'text') last.text += ch
      else out.push({ kind: 'text', text: ch })
      i += 1
      continue
    }
    const action = data[i + 1]
    if (action === undefined) break
    if (action >= SS_TAP && action <= SS_UP) {
      if (i + 2 >= data.length) break
      push(KIND[action as 1 | 2 | 3], data[i + 2])
      i += 3
    } else if (action >= EXT_TAP && action <= EXT_UP) {
      if (i + 3 >= data.length) break
      let keycode = data[i + 2] | (data[i + 3] << 8)
      // 0xFF00より上は、上位バイトに入れたものを戻す(QMKのdecode_keycode)
      if (keycode > 0xff00) keycode = (keycode & 0xff) << 8
      push(KIND[(action - EXT_TAP + SS_TAP) as 1 | 2 | 3], keycode)
      i += 4
    } else if (action === SS_DELAY) {
      if (i + 3 >= data.length) break
      out.push({ kind: 'delay', ms: data[i + 2] - 1 + (data[i + 3] - 1) * 255 })
      i += 4
    } else {
      i += 2 // 壊れている。飛ばして続ける(vial-guiと同じ)
    }
  }
  return out
}

/** マクロ領域(NULで区切った並び)から、count個のマクロを取り出す。足りない分は空。 */
export function decodeMacroBuffer(buffer: Uint8Array, count: number): MacroAction[][] {
  const macros: MacroAction[][] = []
  let start = 0
  for (let i = 0; i < buffer.length && macros.length < count; i++) {
    if (buffer[i] !== 0) continue
    macros.push(decodeMacro(buffer.subarray(start, i)))
    start = i + 1
  }
  while (macros.length < count) macros.push([])
  return macros
}

/** マクロ領域を読み終えたか(count個ぶんのNULが揃ったか)。 */
export function macroBufferComplete(buffer: Uint8Array, count: number): boolean {
  let terminators = 0
  for (const byte of buffer) if (byte === 0) terminators++
  return terminators >= count
}

/** マクロを1行の文にする。キーの名前はkeyNameで出す(JIS / USの表示に合わせる)。 */
export function formatMacro(
  actions: readonly MacroAction[],
  keyName: (raw: number) => string
): string {
  return actions
    .map((action) => {
      if (action.kind === 'text') return `"${action.text}"`
      if (action.kind === 'delay') return `${action.ms}ms`
      // タップはそのまま、押す / 離すは矢印を付ける
      const mark = { tap: '', down: '↓', up: '↑' }[action.kind]
      return action.keycodes.map((kc) => `${mark}${keyName(kc)}`).join(' ')
    })
    .join(' ')
}

/** コンボを1行の文にする(「A + S → Esc」)。 */
export function formatCombo(combo: ComboEntry, keyName: (raw: number) => string): string {
  return `${combo.keys.map(keyName).join(' + ')} → ${keyName(combo.output)}`
}
