/**
 * 打鍵のヒートマップ。どの物理キーを何回押したかを数える(設定の「打鍵を数える」をオンにしたときだけ)。
 *
 * 数えるのはキーごとの回数だけで、打った順番や時刻は残さない(何を打ったかは分からない)。
 * キーボード(UID)ごとに、このPCのlocalStorageに持つ。押すたびには書かず、まとめて書く
 * (hooks/useKeyHeatmap.ts)。
 */

const KEY_PREFIX = 'lkv.heatmap.'

export interface HeatmapData {
  /** 数え始めた日時(ISO)。 */
  since: string
  /** `row,col` → 押した回数。 */
  counts: Record<string, number>
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 使えない環境(テストのnodeなど)
  }
}

function looksLikeHeatmap(value: unknown): value is HeatmapData {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Partial<HeatmapData>
  return (
    typeof data.since === 'string' &&
    typeof data.counts === 'object' &&
    data.counts !== null &&
    Object.values(data.counts).every((n) => Number.isInteger(n) && n >= 0)
  )
}

export class HeatmapStore {
  constructor(private readonly storage: StorageLike | null = defaultStorage()) {}

  load(uid: string): HeatmapData | null {
    try {
      const raw = this.storage?.getItem(KEY_PREFIX + uid)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      return looksLikeHeatmap(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  save(uid: string, data: HeatmapData): void {
    try {
      this.storage?.setItem(KEY_PREFIX + uid, JSON.stringify(data))
    } catch {
      // 容量不足など。数えた分は次に書くときにまた試す
    }
  }

  clear(uid: string): void {
    try {
      this.storage?.removeItem(KEY_PREFIX + uid)
    } catch {
      // 消せなくても、画面の数は空に戻る
    }
  }
}

/**
 * 回数を塗りの濃さ(0〜1)にする。対数で縮める(よく押すキーは何百倍も押すので、そのままだと
 * ほかのキーがみな薄くなって違いが見えない)。押していないキーは入れない。
 */
export function heatLevels(counts: Readonly<Record<string, number>>): Map<string, number> {
  const max = Math.max(0, ...Object.values(counts))
  const levels = new Map<string, number>()
  if (max === 0) return levels
  for (const [id, count] of Object.entries(counts)) {
    if (count > 0) levels.set(id, Math.log1p(count) / Math.log1p(max))
  }
  return levels
}

/**
 * 押しているキーの一覧を前回と比べ、新しく加わったキーを1回ずつ数える(押しっぱなしは1回)。
 * 数えるものが無ければ、同じcountsを返す(画面を描き直さなくて済むように)。
 */
export function countNewPresses(
  counts: Readonly<Record<string, number>>,
  previous: ReadonlySet<string>,
  held: ReadonlySet<string>
): Readonly<Record<string, number>> {
  const added = [...held].filter((id) => !previous.has(id))
  if (added.length === 0) return counts
  const next = { ...counts }
  for (const id of added) next[id] = (next[id] ?? 0) + 1
  return next
}

/** 押した回数の合計。 */
export function totalPresses(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}
