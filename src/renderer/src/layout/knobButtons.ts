/**
 * ノブ(エンコーダー)を押し込んだときのキーが、行列のどこか。
 *
 * 分かれば、そのキーをノブとして円く描き、回したときの割り当てを上下に挟んで出せる
 * (KeyboardView)。ただVialの定義には書かれていない ― KLEのエンコーダーは飾りで、
 * Cornix LPの定義は図の右端にまとめて置いてあるだけ。なので分かっているキーボードだけここに持つ。
 * 載っていないキーボードのノブは、図の下にまとめて出す(layout/encoderStrip.ts)。
 */

export interface KnobButton {
  /** エンコーダーの番号(KLEの"e"の番号、keymapのエンコーダーの並び)。 */
  index: number
  row: number
  col: number
}

interface KnownBoard {
  name: string
  vendorId: number
  productId: number
  rows: number
  cols: number
  buttons: KnobButton[]
}

const KNOWN_BOARDS: KnownBoard[] = [
  {
    // RMKのファーム。左手のノブ(0番、既定は音量)の押し込みが2,6(既定は消音)、
    // 右手(1番、既定はマウスのホイール)が5,6(既定は中クリック)。6列目はこの2つにしか無い。
    // 定義のnameは"HID Keyboard"と汎用的なので、VID / PIDと行列の大きさで見分ける
    name: 'Cornix LP',
    vendorId: 0xe118,
    productId: 0x0001,
    rows: 8,
    cols: 7,
    buttons: [
      { index: 0, row: 2, col: 6 },
      { index: 1, row: 5, col: 6 }
    ]
  }
]

/** 定義のvendorId / productIdは"0xE118"のような文字列で書かれている。数でも受け付ける。 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const parsed = Number.parseInt(value, value.trim().toLowerCase().startsWith('0x') ? 16 : 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** このキーボードのノブの押し込みキー。分からなければ空。 */
export function knobButtonsFor(definition: {
  vendorId?: unknown
  productId?: unknown
  matrix: { rows: number; cols: number }
}): KnobButton[] {
  const vendorId = toNumber(definition.vendorId)
  const productId = toNumber(definition.productId)
  const board = KNOWN_BOARDS.find(
    (known) =>
      known.vendorId === vendorId &&
      known.productId === productId &&
      known.rows === definition.matrix.rows &&
      known.cols === definition.matrix.cols
  )
  return board?.buttons ?? []
}
