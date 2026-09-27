import { describe, expect, it } from 'vitest'
import { countNewPresses, HeatmapStore, heatLevels, totalPresses } from '@/lib/heatmap'

describe('打鍵のヒートマップ', () => {
  it('新しく押されたキーだけを1回ずつ数える(押しっぱなしは1回)', () => {
    let counts: Readonly<Record<string, number>> = {}
    counts = countNewPresses(counts, new Set(), new Set(['0,1']))
    // 押したまま(前回と同じ)なら数えず、同じものを返す
    expect(countNewPresses(counts, new Set(['0,1']), new Set(['0,1']))).toBe(counts)
    counts = countNewPresses(counts, new Set(['0,1']), new Set(['0,1', '7,5']))
    counts = countNewPresses(counts, new Set(), new Set(['0,1']))
    expect(counts).toEqual({ '0,1': 2, '7,5': 1 })
    expect(totalPresses(counts)).toBe(3)
  })

  it('濃さは対数で縮める(よく押すキーだけが濃くなりすぎないように)', () => {
    const levels = heatLevels({ a: 1000, b: 10, c: 0 })
    expect(levels.get('a')).toBe(1)
    // そのまま割ると0.01だが、対数なら3割ほどの濃さが残る
    expect(levels.get('b')).toBeGreaterThan(0.3)
    expect(levels.has('c')).toBe(false)
    expect(heatLevels({}).size).toBe(0)
  })

  it('キーボードごとに読み書きし、壊れたものは読まない', () => {
    const map = new Map<string, string>()
    const store = new HeatmapStore({
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key)
    })
    store.save('uid1', { since: '2026-09-27T00:00:00.000Z', counts: { '0,1': 3 } })
    expect(store.load('uid1')?.counts).toEqual({ '0,1': 3 })
    expect(store.load('uid2')).toBeNull()
    map.set('lkv.heatmap.uid2', JSON.stringify({ since: 'x', counts: { a: -1 } }))
    expect(store.load('uid2')).toBeNull()
    store.clear('uid1')
    expect(store.load('uid1')).toBeNull()
  })
})
