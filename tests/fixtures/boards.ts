/**
 * モックが名乗る「Cornix以外のキーボード」。
 *
 * このアプリは固定データを持たない。配置もキーマップもレイヤー数もキーボードから読む
 * (docs/ARCHITECTURE.md §1)。その前提が本当かを、別の機種で実際に動かして確認するための
 * 材料(tests/otherKeyboard.test.tsx)。定義JSONはscripts/gen-test-boards.pyで作る。
 */
import type { MockKeyboard } from '@/hid/mockTransport'
import { QK_LAYER_TAP, QK_MOMENTARY } from '@/keycodes/decode'
import { BIG_MATRIX_DEFINITION_XZ_BASE64, PLAIN60_DEFINITION_XZ_BASE64 } from './boards.generated'

const KC_A = 0x04
const KC_ESC = 0x29
const KC_SPACE = 0x2c
const KC_F1 = 0x3a
const KC_TRANSPARENT = 0x0001

/** [layer][row][col]を平らに並べる。 */
function flatten(layers: number, rows: number, cols: number, fill: number): number[] {
  return new Array(layers * rows * cols).fill(fill)
}

const PLAIN_LAYERS = 4
const PLAIN_ROWS = 5
const PLAIN_COLS = 14

function plainKeymap(): number[] {
  const keymap = flatten(PLAIN_LAYERS, PLAIN_ROWS, PLAIN_COLS, KC_TRANSPARENT)
  const at = (layer: number, row: number, col: number): number =>
    layer * PLAIN_ROWS * PLAIN_COLS + row * PLAIN_COLS + col

  // L0はAから順の英字で埋める(ラベルが出ることを確認できればよい)
  for (let row = 0; row < PLAIN_ROWS; row++) {
    for (let col = 0; col < PLAIN_COLS; col++) {
      keymap[at(0, row, col)] = KC_A + ((row * PLAIN_COLS + col) % 26)
    }
  }
  keymap[at(0, 0, 0)] = KC_ESC
  keymap[at(0, 4, 0)] = QK_MOMENTARY | 1 // MO(1)
  keymap[at(0, 4, 1)] = QK_LAYER_TAP | (2 << 8) | KC_SPACE // LT(2, Space)

  keymap[at(1, 0, 1)] = KC_F1
  keymap[at(2, 0, 1)] = KC_A
  // L3は透過のまま(中身の無いレイヤーの扱いを通す)
  return keymap
}

/**
 * 素直な60%風。Cornixと違うところ:
 * 行列の大きさ・レイヤー数・**ノブ無し**・**レイアウトオプション無し**・
 * **カスタムキーコード無し**・**Tap Dance無し**。
 */
export const PLAIN60: MockKeyboard = {
  label: 'Plain60 (モック)',
  viaProtocol: 9,
  vialProtocol: 6,
  uid: 0x1122334455667788n,
  definitionXzBase64: PLAIN60_DEFINITION_XZ_BASE64,
  layers: PLAIN_LAYERS,
  rows: PLAIN_ROWS,
  cols: PLAIN_COLS,
  keymap: plainKeymap(),
  tapDance: [],
  encoders: []
}

/**
 * matrix stateが1パケット(28バイト)に収まらない大きさ。
 * `(floor(20 / 8) + 1) * 10 = 30 > 28`なので、押下は読めない(docs/PROTOCOL.md §2)。
 */
export const BIG_MATRIX: MockKeyboard = {
  label: 'BigMatrix (モック)',
  viaProtocol: 9,
  vialProtocol: 6,
  uid: 0x99aabbccddeeff00n,
  definitionXzBase64: BIG_MATRIX_DEFINITION_XZ_BASE64,
  layers: 2,
  rows: 10,
  cols: 20,
  keymap: flatten(2, 10, 20, KC_A),
  tapDance: [],
  encoders: []
}
