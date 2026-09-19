/**
 * KLE(keyboard-layout-editor)形式のパーサ。
 *
 * vial-gui の src/main/python/kle_serial.py(ijprest/kle-serial の移植)と
 * 同じ挙動になるように書いてある。ラベルの並べ替え表や、rx / ry がクラスタ原点を
 * リセットする点まで合わせてある。docs/PROTOCOL.md §4 を参照。
 */

export interface KleKey {
  /** 並べ替え後のラベル 12 個。0 が "row,col"、4 が "e"(エンコーダー)、8 がレイアウト選択。 */
  labels: (string | null)[]
  x: number
  y: number
  width: number
  height: number
  rotationX: number
  rotationY: number
  rotationAngle: number
  decal: boolean
  ghost: boolean
  color: string
}

export interface KleKeyboard {
  keys: KleKey[]
}

/** align(`{"a": n}`)ごとの、入力順 → 出力位置の対応表。 */
const LABEL_MAP: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 6, 2, 8, 9, 11, 3, 5, 1, 4, 7, 10], // 0 = 中央寄せなし
  [1, 7, -1, -1, 9, 11, 4, -1, -1, -1, -1, 10], // 1 = x 中央
  [3, -1, 5, -1, 9, 11, -1, -1, 4, -1, -1, 10], // 2 = y 中央
  [4, -1, -1, -1, 9, 11, -1, -1, -1, -1, -1, 10], // 3 = x, y 中央
  [0, 6, 2, 8, 10, -1, 3, 5, 1, 4, 7, -1], // 4 = front 中央(既定)
  [1, 7, -1, -1, 10, -1, 4, -1, -1, -1, -1, -1], // 5 = front, x 中央
  [3, -1, 5, -1, 10, -1, -1, -1, 4, -1, -1, -1], // 6 = front, y 中央
  [4, -1, -1, -1, 10, -1, -1, -1, -1, -1, -1, -1] // 7 = front, x, y 中央
]

function reorderLabels(labels: string[], align: number): (string | null)[] {
  const out: (string | null)[] = new Array(12).fill(null)
  const map = LABEL_MAP[align] ?? LABEL_MAP[4]
  for (let i = 0; i < labels.length && i < 12; i++) {
    if (labels[i]) {
      const target = map[i]
      if (target >= 0) out[target] = labels[i]
    }
  }
  return out
}

type KleProps = Record<string, unknown>

/** KLE の行配列(定義 JSON の `layouts.keymap`)をキー一覧に展開する。 */
export function parseKle(rows: unknown[]): KleKeyboard {
  const keys: KleKey[] = []
  let align = 4

  // 「次のキー」に引き継がれる状態
  let x = 0
  let y = 0
  let width = 1
  let height = 1
  let rotationX = 0
  let rotationY = 0
  let rotationAngle = 0
  let decal = false
  let ghost = false
  let color = '#cccccc'
  let clusterX = 0
  let clusterY = 0

  for (const row of rows) {
    if (!Array.isArray(row)) continue // 先頭のメタデータなど

    for (let k = 0; k < row.length; k++) {
      const item = row[k]

      if (typeof item === 'string') {
        keys.push({
          labels: reorderLabels(item.split('\n'), align),
          x,
          y,
          width,
          height,
          rotationX,
          rotationY,
          rotationAngle,
          decal,
          ghost,
          color
        })
        x += width
        width = 1
        height = 1
        decal = false
        continue
      }

      if (item === null || typeof item !== 'object') continue
      const props = item as KleProps

      if (k !== 0 && ('r' in props || 'rx' in props || 'ry' in props)) {
        throw new Error('KLE: 回転は行の先頭キーでしか指定できない')
      }
      if (typeof props.r === 'number') rotationAngle = props.r
      if (typeof props.rx === 'number') {
        rotationX = clusterX = props.rx
        x = clusterX
        y = clusterY
      }
      if (typeof props.ry === 'number') {
        rotationY = clusterY = props.ry
        x = clusterX
        y = clusterY
      }
      if (typeof props.a === 'number') align = props.a
      if (typeof props.c === 'string') color = props.c
      if (typeof props.x === 'number') x += props.x
      if (typeof props.y === 'number') y += props.y
      if (typeof props.w === 'number') width = props.w
      if (typeof props.h === 'number') height = props.h
      if (typeof props.d === 'boolean') decal = props.d
      if (typeof props.g === 'boolean' && props.g) ghost = props.g
    }

    // 行末
    y += 1
    x = rotationX
  }

  return { keys }
}
