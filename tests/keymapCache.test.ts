import { describe, expect, it } from 'vitest'
import { LocalStorageKeymapCache } from '@/hid/keymapCache'
import type { CachedKeymap } from '@/hid/vial'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value)
  }
}

const ENTRY: CachedKeymap = {
  definitionSize: 900,
  layers: 2,
  rows: 1,
  cols: 3,
  keymap: [[[4, 5, 6]], [[7, 8, 9]]],
  tapDance: [{ onTap: 1, onHold: 2, onDoubleTap: 3, onTapHold: 4, tappingTerm: 200 }],
  encoders: [[[10, 11]], [[12, 13]]],
  layoutOptions: 0
}

describe('LocalStorageKeymapCache', () => {
  it('しまったものを UID で返す', () => {
    const cache = new LocalStorageKeymapCache(memoryStorage())
    cache.set('123', ENTRY)
    expect(cache.get('123')).toEqual(ENTRY)
    expect(cache.get('456')).toBeNull()
  })

  it('キーボードごとに 1 件だけ持つ(増え続けない)', () => {
    const storage = memoryStorage()
    const cache = new LocalStorageKeymapCache(storage)
    cache.set('123', ENTRY)
    cache.set('123', { ...ENTRY, layoutOptions: 3 })
    expect(storage.items.size).toBe(1)
    expect(cache.get('123')?.layoutOptions).toBe(3)
  })

  it('大きさの合わないキーマップは捨てる(そのまま描くと図が崩れる)', () => {
    const storage = memoryStorage()
    const cache = new LocalStorageKeymapCache(storage)
    // レイヤーが1つ足りない / 列が1つ足りない
    storage.items.set('vial-keymap:1', JSON.stringify({ ...ENTRY, keymap: [[[4, 5, 6]]] }))
    storage.items.set('vial-keymap:2', JSON.stringify({ ...ENTRY, cols: 4 }))
    expect(cache.get('1')).toBeNull()
    expect(cache.get('2')).toBeNull()
  })

  it('壊れた中身や形の違う中身は、無いものとして扱う', () => {
    const storage = memoryStorage()
    const cache = new LocalStorageKeymapCache(storage)
    storage.items.set('vial-keymap:1', '{not json')
    storage.items.set('vial-keymap:2', JSON.stringify({ ...ENTRY, definitionSize: 0 }))
    storage.items.set('vial-keymap:3', JSON.stringify({ ...ENTRY, keymap: 'x' }))
    storage.items.set('vial-keymap:4', JSON.stringify({ ...ENTRY, encoders: 5 }))
    expect(cache.get('1')).toBeNull()
    expect(cache.get('2')).toBeNull()
    expect(cache.get('3')).toBeNull()
    expect(cache.get('4')).toBeNull()
  })

  it('書き込めなくても例外にしない(次に繋いだときに読めば済む)', () => {
    const cache = new LocalStorageKeymapCache({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    })
    expect(() => cache.set('123', ENTRY)).not.toThrow()
  })

  it('localStorage が無い環境では、何もしないキャッシュになる', () => {
    const cache = new LocalStorageKeymapCache(null)
    cache.set('123', ENTRY)
    expect(cache.get('123')).toBeNull()
  })
})
