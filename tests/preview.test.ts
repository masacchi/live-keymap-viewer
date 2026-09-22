/** 図のプレビューの規則(hooks/usePreview.ts の純粋な部分)。 */
import { describe, expect, it } from 'vitest'
import {
  NO_PREVIEW,
  type PreviewAction,
  type PreviewState,
  previewReducer,
  resolvePreview,
  type SymbolLookup
} from '@/hooks/usePreview'

const at = (layer: number): SymbolLookup => ({
  symbol: '@',
  route: { layer, row: 0, col: 1, shift: false, tap: false, cost: layer > 0 ? 1 : 0 }
})

function run(...actions: PreviewAction[]): PreviewState {
  return actions.reduce(previewReducer, NO_PREVIEW)
}

const normal = (state: PreviewState, displayLayer = 0) =>
  resolvePreview(state, { overlay: false, displayLayer })

describe('プレビュー: 乗せる・固定', () => {
  it('乗せているあいだはそのレイヤーを出し、固定より勝つ', () => {
    const state = run({ type: 'pin', layer: 3 }, { type: 'hover', layer: 2 })
    expect(normal(state)).toMatchObject({ previewLayer: 2, pinned: false })
    expect(normal(previewReducer(state, { type: 'hover', layer: null }))).toMatchObject({
      previewLayer: 3,
      pinned: true
    })
  })

  it('実際に出ているレイヤーを出しても、プレビューとは言わない', () => {
    expect(normal(run({ type: 'pin', layer: 2 }), 2).previewLayer).toBeNull()
  })

  it('オーバーレイではプレビューしない(クリックが透過するので選べない)', () => {
    const state = run({ type: 'pin', layer: 2 })
    expect(resolvePreview(state, { overlay: true, displayLayer: 0 }).previewLayer).toBeNull()
  })
})

describe('プレビュー: 戻す', () => {
  it('キーを押したら全部やめる', () => {
    const state = run({ type: 'hover', layer: 1 }, { type: 'pickSymbol', lookup: at(2) })
    expect(previewReducer(state, { type: 'keyPressed' })).toEqual(NO_PREVIEW)
  })

  it('Esc は固定と記号の案内をやめ、乗せているものはそのまま(外せば戻る)', () => {
    const state = run({ type: 'pin', layer: 3 }, { type: 'hover', layer: 1 }, { type: 'escape' })
    expect(state).toEqual({ hovered: 1, pinned: null, lookup: null })
  })

  it('レイヤーの数が減ったら、範囲外の番号と記号の案内を捨てる', () => {
    const state = run(
      { type: 'hover', layer: 1 },
      { type: 'pickSymbol', lookup: at(7) },
      { type: 'hover', layer: 6 },
      { type: 'layerCount', count: 4 }
    )
    expect(state).toEqual({ hovered: null, pinned: null, lookup: null })
  })
})

describe('プレビュー: 記号の案内', () => {
  it('選ぶとそのレイヤーを固定し、案内を効かせる', () => {
    const resolved = normal(run({ type: 'hover', layer: 1 }, { type: 'pickSymbol', lookup: at(2) }))
    expect(resolved).toMatchObject({ previewLayer: 2, pinned: true })
    expect(resolved.lookup?.symbol).toBe('@')
  })

  it('ベースレイヤーで打てる記号は、プレビューせず案内だけ効かせる', () => {
    const resolved = normal(run({ type: 'pickSymbol', lookup: at(0) }))
    expect(resolved.previewLayer).toBeNull()
    expect(resolved.lookup).not.toBeNull()
  })

  it('ほかのレイヤーに乗せているあいだは効かせず、外せば戻る', () => {
    const hovering = run({ type: 'pickSymbol', lookup: at(2) }, { type: 'hover', layer: 3 })
    expect(normal(hovering).lookup).toBeNull()
    expect(normal(previewReducer(hovering, { type: 'hover', layer: null })).lookup).not.toBeNull()
  })

  it('固定を変えたら案内はやめる', () => {
    const state = run({ type: 'pickSymbol', lookup: at(2) }, { type: 'pin', layer: 3 })
    expect(state.lookup).toBeNull()
  })
})
