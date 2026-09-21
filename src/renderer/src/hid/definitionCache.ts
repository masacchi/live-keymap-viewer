/**
 * キーボード定義のキャッシュを localStorage に置く(hid/vial.ts の DefinitionCache)。
 *
 * 通常ウィンドウとオーバーレイの切り替えはウィンドウごと作り直すので、renderer のメモリに
 * 持っても消えてしまう。localStorage なら両方のウィンドウ(同じ file:// のオリジン)で共有でき、
 * アプリを閉じても残る。
 *
 * キーボードごとに 1 件だけ持つ(UID で引く)。バイト数が違えば別物とみなして読み直させる。
 * 中身は信用せず、形が崩れていれば無いものとして扱う(読み直せば済むので)。
 */
import type { DefinitionCache, VialDefinition } from './vial'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const KEY_PREFIX = 'vial-definition:'

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

/** このアプリが使うところだけ、形を確かめる。 */
function looksLikeDefinition(value: unknown): value is VialDefinition {
  if (typeof value !== 'object' || value === null) return false
  const { matrix, layouts } = value as Partial<VialDefinition>
  return (
    isCount(matrix?.rows) &&
    isCount(matrix?.cols) &&
    Array.isArray(layouts?.keymap) &&
    (layouts.labels === undefined || Array.isArray(layouts.labels))
  )
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 使えない環境(テストの node など)
  }
}

export class LocalStorageDefinitionCache implements DefinitionCache {
  constructor(private readonly storage: StorageLike | null = defaultStorage()) {}

  get(uid: string, size: number): VialDefinition | null {
    try {
      const raw = this.storage?.getItem(KEY_PREFIX + uid)
      if (!raw) return null
      const stored = JSON.parse(raw) as { size?: unknown; definition?: unknown }
      if (stored.size !== size || !looksLikeDefinition(stored.definition)) return null
      return stored.definition
    } catch {
      return null
    }
  }

  set(uid: string, size: number, definition: VialDefinition): void {
    try {
      this.storage?.setItem(KEY_PREFIX + uid, JSON.stringify({ size, definition }))
    } catch {
      // 容量不足など。次の接続でもう一度読めば済む
    }
  }
}
