/**
 * 「この記号はどう打つか」を、読み込んだキーマップから探す。
 *
 * reference/keymap-preview.htmlの「記号の出し方」と同じ考え方: 各レイヤーのキーが出す文字
 * (Shift側も)を集め、手数の少ない順に並べる。手数は「レイヤーに入る」「Shiftを足す」を1ずつ、
 * タップと長押しを兼ねるキー(LT / Tap Dance / MT)のタップを0.5と数える。
 *
 * どの文字が出るかは表記(JIS / US)で変わるので、ラベルを引く関数を受け取る。
 */
import { decodeKeycode, KC_NO, KC_TRNS, type Keycode } from '../keycodes/decode'
import type { KeyLabel } from '../keycodes/labels'
import { messages } from '../messages'

/** 探す記号。JIS / USのどちらかで出るもの。 */
export const SYMBOLS: readonly string[] = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', '¥']

export interface SymbolRoute {
  /** 文字が出るレイヤー。 */
  layer: number
  row: number
  col: number
  /** Shiftを足すか。 */
  shift: boolean
  /** タップと長押しを兼ねるキーのタップか(「タップ」と添える)。 */
  tap: boolean
  cost: number
}

export interface SymbolRouteInput {
  /** [layer][row][col]の生キーコード。 */
  keymap: number[][][]
  /** キーコードのラベル(表記に合わせたもの)。 */
  labelOf: (keycode: Keycode) => KeyLabel
  /** そのレイヤーに入れるか。行き方の無いレイヤーの文字は、打てないので経路にしない。 */
  reachable: (layer: number) => boolean
}

function isDualRole(keycode: Keycode): boolean {
  return keycode.kind === 'layerTap' || keycode.kind === 'tapDance' || keycode.kind === 'modTap'
}

/** 記号ごとの経路(手数の少ない順)。見つからない記号は空の配列。 */
export function findSymbolRoutes(input: SymbolRouteInput): Map<string, SymbolRoute[]> {
  const routes = new Map<string, SymbolRoute[]>(SYMBOLS.map((symbol) => [symbol, []]))
  input.keymap.forEach((rows, layer) => {
    if (layer !== 0 && !input.reachable(layer)) return
    rows.forEach((cols, row) => {
      cols.forEach((raw, col) => {
        // 透過は下のレイヤーの経路として数えてあるので、ここでは見ない
        if (raw === KC_TRNS || raw === KC_NO) return
        const keycode = decodeKeycode(raw)
        const label = input.labelOf(keycode)
        const tap = isDualRole(keycode)
        const add = (char: string | undefined, shift: boolean): void => {
          const list = char === undefined ? undefined : routes.get(char)
          if (!list) return
          const cost = (layer > 0 ? 1 : 0) + (shift ? 1 : 0) + (tap ? 0.5 : 0)
          list.push({ layer, row, col, shift, tap, cost })
        }
        add(label.main, false)
        add(label.shift, true)
      })
    })
  })
  for (const list of routes.values()) {
    list.sort((a, b) => a.cost - b.cost || a.layer - b.layer || a.row - b.row || a.col - b.col)
  }
  return routes
}

/** ベースレイヤーにあるShiftキーの位置。Shiftを足す経路で、どこを押すかを示すのに使う。 */
export function shiftKeysOf(keymap: number[][][]): Array<{ row: number; col: number }> {
  const keys: Array<{ row: number; col: number }> = []
  keymap[0]?.forEach((cols, row) => {
    cols.forEach((raw, col) => {
      const keycode = decodeKeycode(raw)
      if (keycode.kind === 'basic' && /^KC_[LR]SHIFT$/.test(keycode.name)) keys.push({ row, col })
    })
  })
  return keys
}

/** 経路の一歩(レイヤーに入る / Shift / キー)。 */
export type RouteStep =
  | { kind: 'layer'; layer: number; text: string }
  | { kind: 'shift' }
  | { kind: 'key'; text: string }

/**
 * 経路を手順に分ける。レイヤーは行き方(「Space長押し」)で言い、無ければ番号。
 * キーはベースレイヤーでの名前(L2の@ でも「W」)。キーの位置はふだんの文字で覚えているので。
 */
export function routeSteps(route: SymbolRoute, keyName: string, how: string | null): RouteStep[] {
  const steps: RouteStep[] = []
  if (route.layer > 0)
    steps.push({ kind: 'layer', layer: route.layer, text: how ?? `L${route.layer}` })
  if (route.shift) steps.push({ kind: 'shift' })
  steps.push({ kind: 'key', text: route.tap ? messages.symbols.tap(keyName) : keyName })
  return steps
}
