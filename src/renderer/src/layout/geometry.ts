/**
 * パース済み KLE → 描画に使う物理キー配置。
 *
 * ラベルの意味づけは vial-gui の keyboard_comm.py reload_layout と同じ:
 *   labels[0] = "row,col"(通常キー)/ "encoder_idx,direction"(エンコーダー)
 *   labels[4] = "e" ならエンコーダー
 *   labels[8] = "layout_index,layout_option"
 */
import { type KleKey, parseKle } from './kle'

export interface PhysicalKey {
  row: number
  col: number
  /** 単位は 1u。KLE の座標そのまま。 */
  x: number
  y: number
  width: number
  height: number
  rotationAngle: number
  rotationX: number
  rotationY: number
  /** レイアウト選択に紐づかないキーは -1。 */
  layoutIndex: number
  layoutOption: number
}

export interface EncoderKey {
  index: number
  direction: number
  x: number
  y: number
  width: number
  height: number
  rotationAngle: number
  rotationX: number
  rotationY: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface KeyboardGeometry {
  keys: PhysicalKey[]
  encoders: EncoderKey[]
  /** キーとエンコーダーを含めた、回転後の外接矩形(1u 単位)。 */
  bounds: Bounds
  /**
   * キーだけの外接矩形。
   *
   * 定義によっては、エンコーダーが実際の物理位置ではなく図の端に並べて
   * 置かれていることがある(Cornix LP は右端にまとめて置いてある)。
   * それを含めて枠を取ると横に間延びするので、描画はこちらを使う。
   */
  keyBounds: Bounds
}

/** `row,col` を 1 本の文字列キーにする。Map のキーに使う。 */
export function keyId(row: number, col: number): string {
  return `${row},${col}`
}

function parsePair(label: string): [number, number] | null {
  const parts = label.split(',')
  if (parts.length !== 2) return null
  const a = Number.parseInt(parts[0], 10)
  const b = Number.parseInt(parts[1], 10)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return [a, b]
}

function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  degrees: number
): [number, number] {
  if (degrees === 0) return [x, y]
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - cx
  const dy = y - cy
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

function geometryOf(
  key: KleKey
): Omit<PhysicalKey, 'row' | 'col' | 'layoutIndex' | 'layoutOption'> {
  return {
    x: key.x,
    y: key.y,
    width: key.width,
    height: key.height,
    rotationAngle: key.rotationAngle,
    rotationX: key.rotationX,
    rotationY: key.rotationY
  }
}

/** 回転を考慮した、キー 1 個の四隅。 */
export function keyCorners(
  key: Pick<
    PhysicalKey,
    'x' | 'y' | 'width' | 'height' | 'rotationAngle' | 'rotationX' | 'rotationY'
  >
): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [key.x, key.y],
    [key.x + key.width, key.y],
    [key.x + key.width, key.y + key.height],
    [key.x, key.y + key.height]
  ]
  return pts.map(([px, py]) => rotatePoint(px, py, key.rotationX, key.rotationY, key.rotationAngle))
}

/**
 * 定義 JSON の `layouts.keymap` から物理配置を組み立てる。
 *
 * `matrix` を渡すと、宣言された行列サイズをはみ出すキーを検出してエラーにする
 * (vial-gui の reload_keymap と同じチェック)。
 */
export function buildGeometry(
  kleRows: unknown[],
  matrix?: { rows: number; cols: number }
): KeyboardGeometry {
  const parsed = parseKle(kleRows)
  const keys: PhysicalKey[] = []
  const encoders: EncoderKey[] = []

  for (const key of parsed.keys) {
    const first = key.labels[0]
    const isEncoder = key.labels[4] === 'e'

    if (isEncoder) {
      const pair = first ? parsePair(first) : null
      if (pair) {
        encoders.push({ index: pair[0], direction: pair[1], ...geometryOf(key) })
      }
      continue
    }

    if (!key.decal && !first?.includes(',')) continue

    const pair = first ? parsePair(first) : null
    const [row, col] = pair ?? [0, 0]
    if (matrix && (row >= matrix.rows || col >= matrix.cols)) {
      throw new Error(
        `定義が壊れている: キーが ${row},${col} を指しているが matrix は rows=${matrix.rows} cols=${matrix.cols}`
      )
    }

    let layoutIndex = -1
    let layoutOption = -1
    const layoutLabel = key.labels[8]
    if (layoutLabel) {
      const opt = parsePair(layoutLabel)
      if (opt) [layoutIndex, layoutOption] = opt
    }

    keys.push({ row, col, layoutIndex, layoutOption, ...geometryOf(key) })
  }

  return {
    keys,
    encoders,
    bounds: boundsOf([...keys, ...encoders]),
    keyBounds: boundsOf(keys)
  }
}

/** 回転後の角をすべて含む外接矩形。空なら原点の一点。 */
function boundsOf(items: ReadonlyArray<Parameters<typeof keyCorners>[0]>): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    for (const [px, py] of keyCorners(item)) {
      minX = Math.min(minX, px)
      minY = Math.min(minY, py)
      maxX = Math.max(maxX, px)
      maxY = Math.max(maxY, py)
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/**
 * レイアウト選択で今は出ないキーを落とす。
 * `options[i]` がレイアウト i で選ばれているオプション番号。
 */
export function visibleKeys(keys: PhysicalKey[], options: number[]): PhysicalKey[] {
  return keys.filter(
    (key) => key.layoutIndex < 0 || (options[key.layoutIndex] ?? 0) === key.layoutOption
  )
}
