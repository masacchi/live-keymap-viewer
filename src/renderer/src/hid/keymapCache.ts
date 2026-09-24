/**
 * キーマップのキャッシュをlocalStorageに置く(hid/vial.tsのKeymapCache)。
 *
 * 置き場所をlocalStorageにする理由は定義のキャッシュ(hid/definitionCache.ts)と同じ ―
 * 通常ウィンドウとオーバーレイはウィンドウごと作り直すので、rendererのメモリでは消える。
 *
 * キーボードごとに1件(UIDで引く)。中身は信用せず、形が崩れていれば無いものとして扱う
 * (読み直せば済む)。キーマップはVialで編集され得るので、**これで出した表示は必ず裏で
 * 読み直して確かめる**(session/keyboardSession.ts)。
 */
import type { TapDanceEntry } from '../keycodes/tapDance'
import type { CachedKeymap, KeymapCache } from './vial'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const KEY_PREFIX = 'vial-keymap:'

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

/** [layer][row][col]の形をしているか。中身の数までは見る(大きさが合わないと描画が崩れる)。 */
function isKeymap(value: unknown, layers: number, rows: number, cols: number): boolean {
  if (!Array.isArray(value) || value.length !== layers) return false
  return value.every(
    (layer) =>
      Array.isArray(layer) &&
      layer.length === rows &&
      layer.every(
        (row: unknown) =>
          Array.isArray(row) &&
          row.length === cols &&
          row.every((key: unknown) => typeof key === 'number')
      )
  )
}

function isTapDance(value: unknown): value is Array<TapDanceEntry | undefined> {
  return Array.isArray(value)
}

/** このアプリが使うところだけ、形を確かめる。 */
function looksLikeCachedKeymap(value: unknown): value is CachedKeymap {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<CachedKeymap>
  return (
    isCount(entry.definitionSize) &&
    isCount(entry.layers) &&
    isCount(entry.rows) &&
    isCount(entry.cols) &&
    typeof entry.layoutOptions === 'number' &&
    isKeymap(entry.keymap, entry.layers, entry.rows, entry.cols) &&
    isTapDance(entry.tapDance) &&
    Array.isArray(entry.encoders)
  )
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 使えない環境(テストのnodeなど)
  }
}

export class LocalStorageKeymapCache implements KeymapCache {
  constructor(private readonly storage: StorageLike | null = defaultStorage()) {}

  get(uid: string): CachedKeymap | null {
    try {
      const raw = this.storage?.getItem(KEY_PREFIX + uid)
      if (!raw) return null
      const stored: unknown = JSON.parse(raw)
      return looksLikeCachedKeymap(stored) ? stored : null
    } catch {
      return null
    }
  }

  set(uid: string, value: CachedKeymap): void {
    try {
      this.storage?.setItem(KEY_PREFIX + uid, JSON.stringify(value))
    } catch {
      // 容量不足など。次に繋いだときは普通に読めば済む
    }
  }
}
