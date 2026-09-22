/**
 * 図のプレビュー(実際の状態とは別のレイヤーを出す)の状態と規則。
 *
 * 出し方は 3 通り:
 *   - hovered … レイヤーの一覧のチップにポインタを乗せているあいだ。外せば戻る
 *   - pinned  … チップを押して固定したもの
 *   - lookup  … 記号の出し方で選んだ記号。そのレイヤーを固定し、押すキーを光らせる
 * 乗せている方が固定より勝つ。
 *
 * 戻す規則:
 *   - キーを押したら全部やめる ― 打ち始めたのに違うレイヤーが出たままだと、押したキーと図が食い違う
 *   - Esc で固定と記号の案内をやめる(乗せているものは、外せば戻るのでそのまま)
 *   - レイヤーの数が変わったら(キーボードが替わった)、範囲外の番号と記号の案内を捨てる
 *
 * 規則は previewReducer / resolvePreview の純粋な関数にしてあり、画面なしでテストできる
 * (以前は App の useState 3 つと effect 3 つに散らばっていた)。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { LayerSnapshot } from '../engine/layerState'
import type { SymbolRoute } from '../engine/symbolRoutes'

export interface SymbolLookup {
  symbol: string
  route: SymbolRoute
}

export interface PreviewState {
  hovered: number | null
  pinned: number | null
  lookup: SymbolLookup | null
}

export type PreviewAction =
  | { type: 'hover'; layer: number | null }
  | { type: 'pin'; layer: number | null }
  | { type: 'pickSymbol'; lookup: SymbolLookup }
  | { type: 'keyPressed' }
  | { type: 'escape' }
  | { type: 'layerCount'; count: number }

export const NO_PREVIEW: PreviewState = { hovered: null, pinned: null, lookup: null }

/** 記号の案内のために固定するレイヤー。ベースレイヤーで打てる記号なら固定しない(キーを光らせるだけ)。 */
function pinnedFor(lookup: SymbolLookup): number | null {
  return lookup.route.layer === 0 ? null : lookup.route.layer
}

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'hover':
      return { ...state, hovered: action.layer }
    case 'pin':
      // 一覧やプレビューの札から固定を変えたら、記号の案内は当てはまらなくなる
      return { ...state, pinned: action.layer, lookup: null }
    case 'pickSymbol':
      return { hovered: null, pinned: pinnedFor(action.lookup), lookup: action.lookup }
    case 'keyPressed':
      return state === NO_PREVIEW ? state : NO_PREVIEW
    case 'escape':
      return { ...state, pinned: null, lookup: null }
    case 'layerCount': {
      const valid = (layer: number | null) =>
        layer !== null && layer < action.count ? layer : null
      return { hovered: valid(state.hovered), pinned: valid(state.pinned), lookup: null }
    }
  }
}

export interface ResolvedPreview {
  /** 図に出すレイヤー(実際と違うときだけ)。プレビューしていなければ null。 */
  previewLayer: number | null
  /** 固定のプレビューか(乗せているだけなら false)。札に「戻る」を出すかどうか。 */
  pinned: boolean
  /** いま効いている記号の案内。ほかのレイヤーに乗せたり固定を変えたりしたら null。 */
  lookup: SymbolLookup | null
}

/**
 * 状態から、いま図に何を出すかを決める。オーバーレイはクリックが透過するので、
 * プレビューは通常ウィンドウでだけ効かせる。
 */
export function resolvePreview(
  state: PreviewState,
  { overlay, displayLayer }: { overlay: boolean; displayLayer: number | null }
): ResolvedPreview {
  if (overlay) return { previewLayer: null, pinned: false, lookup: null }
  const requested = state.hovered ?? state.pinned
  // 案内は、選んだときのレイヤーを出したままのあいだだけ効かせる
  const lookup =
    state.lookup && state.hovered === null && state.pinned === pinnedFor(state.lookup)
      ? state.lookup
      : null
  return {
    // 実際に出ているレイヤーを「プレビュー」しても何も変わらないので、札や破線は出さない
    previewLayer: requested === displayLayer ? null : requested,
    pinned: state.hovered === null,
    lookup
  }
}

export interface PreviewHandle extends ResolvedPreview {
  state: PreviewState
  hover: (layer: number | null) => void
  pin: (layer: number | null) => void
  pickSymbol: (symbol: string, route: SymbolRoute) => void
}

/** プレビューの状態を持ち、キーの押下・Esc・レイヤー数の変化で戻す。 */
export function usePreview({
  layers,
  layerCount,
  overlay
}: {
  layers: LayerSnapshot | null
  layerCount: number
  overlay: boolean
}): PreviewHandle {
  const [state, dispatch] = useReducer(previewReducer, NO_PREVIEW)

  // 新しく押されたキーがあれば戻す(離しただけ・押しっぱなしでは戻さない)
  const heldRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const held = new Set(layers?.held.keys() ?? [])
    const pressedNew = [...held].some((id) => !heldRef.current.has(id))
    heldRef.current = held
    if (pressedNew) dispatch({ type: 'keyPressed' })
  }, [layers])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dispatch({ type: 'escape' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => dispatch({ type: 'layerCount', count: layerCount }), [layerCount])

  const hover = useCallback((layer: number | null) => dispatch({ type: 'hover', layer }), [])
  const pin = useCallback((layer: number | null) => dispatch({ type: 'pin', layer }), [])
  const pickSymbol = useCallback(
    (symbol: string, route: SymbolRoute) =>
      dispatch({ type: 'pickSymbol', lookup: { symbol, route } }),
    []
  )

  return {
    state,
    ...resolvePreview(state, { overlay, displayLayer: layers?.displayLayer ?? null }),
    hover,
    pin,
    pickSymbol
  }
}
