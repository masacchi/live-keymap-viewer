/**
 * 読み込んだキーマップから、画面の案内に使うものを作る。
 *
 * - 各レイヤーへの行き方(「Space長押し」)と、空のレイヤー(engine/layerSummary.ts)
 * - 記号ごとの打ち方(engine/symbolRoutes.ts)
 * - キーの名前(ベースレイヤーでの表示。「Wの位置」「TabとQを押し続ける」の言い方に使う)
 *
 * どれもキーマップと表記(JIS / US)だけで決まり、押下には左右されない。以前はAppに並んでいた。
 */
import { useCallback, useMemo } from 'react'
import { describeTrigger, type LayerSummary, summarizeLayers } from '../engine/layerSummary'
import {
  findSymbolRoutes,
  type RouteStep,
  routeSteps,
  type SymbolRoute,
  shiftKeysOf
} from '../engine/symbolRoutes'
import type { KeyboardSnapshot } from '../hid/vial'
import { decodeKeycode } from '../keycodes/decode'
import { type LabelContext, type LabelMode, labelForKeycode } from '../keycodes/labels'

type KeyPosition = { row: number; col: number }

export interface KeymapGuide {
  summaries: readonly LayerSummary[]
  labelContext: LabelContext
  /** そのレイヤーへの行き方(「Space長押し」)。無ければnull。 */
  howTo: (layer: number) => string | null
  /** ベースレイヤーでのキーの名前。 */
  baseKeyName: (position: KeyPosition) => string
  /** 記号ごとの打ち方(手数の少ない順)。 */
  symbolRoutes: ReadonlyMap<string, readonly SymbolRoute[]>
  /** 打ち方を手順(レイヤー → Shift → キー)に分けたもの。 */
  stepsOf: (route: SymbolRoute) => RouteStep[]
  /** 記号を打つのに押すキー(Shiftを足すならベースレイヤーのShiftも)。図で光らせる。 */
  keysToPress: (route: SymbolRoute) => KeyPosition[]
}

export function useKeymapGuide(
  snapshot: KeyboardSnapshot | null,
  labelMode: LabelMode
): KeymapGuide {
  const summaries = useMemo(() => (snapshot ? summarizeLayers(snapshot) : []), [snapshot])
  const labelContext = useMemo<LabelContext>(
    () => ({ customKeycodes: snapshot?.definition.customKeycodes, tapDance: snapshot?.tapDance }),
    [snapshot]
  )

  const howTo = useCallback(
    (layer: number) => {
      const trigger = summaries[layer]?.triggers[0]
      return trigger ? describeTrigger(trigger, labelMode, labelContext) : null
    },
    [summaries, labelMode, labelContext]
  )

  const baseKeyName = useCallback(
    ({ row, col }: KeyPosition) =>
      labelForKeycode(
        decodeKeycode(snapshot?.keymap[0]?.[row]?.[col] ?? 0),
        labelMode,
        labelContext
      ).main,
    [snapshot, labelMode, labelContext]
  )

  // どの文字が出るかは表記で変わる。行き方の無いレイヤーの文字は打てないので数えない
  const symbolRoutes = useMemo(
    () =>
      snapshot
        ? findSymbolRoutes({
            keymap: snapshot.keymap,
            labelOf: (keycode) => labelForKeycode(keycode, labelMode, labelContext),
            reachable: (layer) => (summaries[layer]?.triggers.length ?? 0) > 0
          })
        : new Map<string, SymbolRoute[]>(),
    [snapshot, labelMode, labelContext, summaries]
  )

  const stepsOf = useCallback(
    (route: SymbolRoute) => routeSteps(route, baseKeyName(route), howTo(route.layer)),
    [baseKeyName, howTo]
  )

  const shiftKeys = useMemo(() => (snapshot ? shiftKeysOf(snapshot.keymap) : []), [snapshot])
  const keysToPress = useCallback(
    (route: SymbolRoute) => [route, ...(route.shift ? shiftKeys : [])],
    [shiftKeys]
  )

  return { summaries, labelContext, howTo, baseKeyName, symbolRoutes, stepsOf, keysToPress }
}
