import { describe, expect, it } from 'vitest'
import { LocalStorageDefinitionCache } from '@/hid/definitionCache'
import type { VialDefinition } from '@/hid/vial'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value)
  }
}

const DEFINITION: VialDefinition = {
  name: 'Cornix',
  matrix: { rows: 8, cols: 7 },
  layouts: { keymap: [['0,0']] }
}

describe('LocalStorageDefinitionCache', () => {
  it('UID とバイト数が合えば、しまったものを返す', () => {
    const cache = new LocalStorageDefinitionCache(memoryStorage())
    cache.set('123', 900, DEFINITION)
    expect(cache.get('123', 900)).toEqual(DEFINITION)
  })

  it('バイト数が違えば別物とみなす(読み直させる)', () => {
    const cache = new LocalStorageDefinitionCache(memoryStorage())
    cache.set('123', 900, DEFINITION)
    expect(cache.get('123', 901)).toBeNull()
    expect(cache.get('456', 900)).toBeNull()
  })

  it('キーボードごとに 1 件だけ持つ(増え続けない)', () => {
    const storage = memoryStorage()
    const cache = new LocalStorageDefinitionCache(storage)
    cache.set('123', 900, DEFINITION)
    cache.set('123', 950, DEFINITION)
    expect(storage.items.size).toBe(1)
    expect(cache.get('123', 950)).toEqual(DEFINITION)
  })

  it('壊れた中身や形の違う中身は、無いものとして扱う', () => {
    const storage = memoryStorage()
    const cache = new LocalStorageDefinitionCache(storage)
    storage.items.set('vial-definition:1', '{not json')
    storage.items.set(
      'vial-definition:2',
      JSON.stringify({ size: 900, definition: { matrix: {} } })
    )
    storage.items.set(
      'vial-definition:3',
      JSON.stringify({ size: 900, definition: { ...DEFINITION, layouts: { keymap: 'x' } } })
    )
    expect(cache.get('1', 900)).toBeNull()
    expect(cache.get('2', 900)).toBeNull()
    expect(cache.get('3', 900)).toBeNull()
  })

  it('書き込めなくても例外にしない(次の接続で読み直せば済む)', () => {
    const cache = new LocalStorageDefinitionCache({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    })
    expect(() => cache.set('123', 900, DEFINITION)).not.toThrow()
  })

  it('localStorage が無い環境では、何もしないキャッシュになる', () => {
    const cache = new LocalStorageDefinitionCache(null)
    cache.set('123', 900, DEFINITION)
    expect(cache.get('123', 900)).toBeNull()
  })
})
