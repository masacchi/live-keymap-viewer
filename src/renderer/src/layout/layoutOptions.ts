/**
 * VIA のレイアウトオプション(1 個の整数)を、選択肢ごとの値にほどく。
 *
 * vial-gui の editor/layout_editor.py と同じ扱い:
 * 選択肢ごとに必要なビット数だけを占め、それを順に連結したビット列になっている。
 * **後ろの選択肢ほど下位ビット**に入る("VIA stores option choices backwards")。
 */

/** `layouts.labels` の 1 要素。文字列なら ON/OFF、配列なら [名前, 選択肢…]。 */
export type LayoutLabel = string | string[]

function bitLength(value: number): number {
  let bits = 0
  while (value > 0) {
    bits++
    value >>= 1
  }
  return bits
}

/** 選択肢 1 個が占めるビット数。 */
export function optionBits(label: LayoutLabel): number {
  if (typeof label === 'string') return 1 // ON/OFF
  const choices = Math.max(1, label.length - 1)
  return Math.max(1, bitLength(choices - 1))
}

/** 整数 → 選択肢ごとの値。labels が無ければ空配列。 */
export function decodeLayoutOptions(value: number, labels?: unknown[]): number[] {
  if (!labels || labels.length === 0) return []
  const sizes = labels.map((label) => optionBits(label as LayoutLabel))
  const out = new Array<number>(sizes.length).fill(0)
  let rest = value >>> 0
  for (let i = sizes.length - 1; i >= 0; i--) {
    const size = sizes[i]
    out[i] = rest & ((1 << size) - 1)
    rest >>>= size
  }
  return out
}

/** 選択肢ごとの値 → 整数。decodeLayoutOptions の逆。 */
export function encodeLayoutOptions(choices: number[], labels?: unknown[]): number {
  if (!labels || labels.length === 0) return 0
  let value = 0
  labels.forEach((label, i) => {
    const size = optionBits(label as LayoutLabel)
    value = (value << size) | (choices[i] ?? 0)
  })
  return value >>> 0
}
