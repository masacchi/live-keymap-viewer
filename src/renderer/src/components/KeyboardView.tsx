/** キーボード全体の SVG。物理配置は定義の KLE から来るので固定データは持たない。 */
import { type JSX, useMemo } from 'react'
import type { LayerEngine, LayerSnapshot } from '../engine/layerState'
import type { KeyboardSnapshot } from '../hid/vial'
import { decodeKeycode, MOD_SHIFT } from '../keycodes/decode'
import { type LabelContext, type LabelMode, labelForKeycode } from '../keycodes/labels'
import { holdLayerOf } from '../keycodes/tapDance'
import { type EncoderPlacement, layoutEncoderStrip, viewBoxFor } from '../layout/encoderStrip'
import { type KeyboardGeometry, keyId, visibleKeys } from '../layout/geometry'
import { decodeLayoutOptions } from '../layout/layoutOptions'
import { layerColor } from '../lib/theme'
import { KeyCap } from './KeyCap'

export interface KeyboardViewProps {
  geometry: KeyboardGeometry
  snapshot: KeyboardSnapshot
  engine: LayerEngine
  layers: LayerSnapshot
  labelMode: LabelMode
  /** アンロックのために押すべきキー。ロック中だけ渡す。 */
  unlockKeys?: Array<{ row: number; col: number }>
  /** ノブの割り当てを並べる位置。 */
  encoderPlacement?: EncoderPlacement
  unit?: number
  /** キーをクリックしたとき。モックでキーを押す/離すのに使う(実機では渡さない)。 */
  onKeyClick?: (row: number, col: number) => void
  /**
   * 実際の状態とは別に、このレイヤーを図に出す(プレビュー)。透過のキーは既定レイヤーの
   * 値をたどる。押しているキーの表示は実際の状態のまま。
   */
  previewLayer?: number | null
  /** レイヤーの名前(番号順、'' は名前なし)。長押しの色帯などに使う。 */
  layerNames?: readonly string[]
  /**
   * 縁取るキー。プレビュー中に、そのレイヤーに入るキー(Space など)を示すのに使う。
   * 色は図に出しているレイヤーの色。
   */
  highlightKeys?: ReadonlyArray<{ row: number; col: number }>
}

/** ノブの割り当て文字の大きさ(px)。styles.css の .encoder-label と揃える。 */
const ENCODER_FONT = 13

export function KeyboardView({
  geometry,
  snapshot,
  engine,
  layers,
  labelMode,
  unlockKeys = [],
  encoderPlacement = 'bottom',
  unit = 58,
  onKeyClick,
  previewLayer = null,
  layerNames = [],
  highlightKeys = []
}: KeyboardViewProps): JSX.Element {
  // Shift を押しているあいだは、Shift で入る文字の方を目立たせる
  const shifted = (layers.mods & MOD_SHIFT) !== 0

  // 図に出すレイヤーの解決に使う状態。プレビュー中は、そのレイヤーと既定レイヤーだけが有効な体にする
  const view = useMemo<LayerSnapshot>(() => {
    if (previewLayer === null) return layers
    const active = [...new Set([layers.defaultLayer, previewLayer])].sort((a, b) => a - b)
    return { ...layers, displayLayer: previewLayer, activeLayers: active }
  }, [layers, previewLayer])

  const labelContext = useMemo<LabelContext>(
    () => ({
      customKeycodes: snapshot.definition.customKeycodes,
      tapDance: snapshot.tapDance
    }),
    [snapshot]
  )

  const layoutOptions = useMemo(
    () => decodeLayoutOptions(snapshot.layoutOptions, snapshot.definition.layouts.labels),
    [snapshot.layoutOptions, snapshot.definition.layouts.labels]
  )
  const keys = useMemo(
    () => visibleKeys(geometry.keys, layoutOptions),
    [geometry.keys, layoutOptions]
  )

  // ノブの割り当ては "↑" だけだと何の ↑ か分からないので、短いものには補足を足す
  const labelOf = useMemo(
    () =>
      (raw: number): string => {
        const label = labelForKeycode(decodeKeycode(raw), labelMode, labelContext)
        if (label.sub && [...label.main].length <= 2) return `${label.main} ${label.sub}`
        return label.main
      },
    [labelMode, labelContext]
  )

  const unlockSet = useMemo(() => new Set(unlockKeys.map((k) => keyId(k.row, k.col))), [unlockKeys])
  const highlightSet = useMemo(
    () => new Set(highlightKeys.map((k) => keyId(k.row, k.col))),
    [highlightKeys]
  )

  const strip = useMemo(() => {
    const items = geometry.encoders
      .filter((encoder) => encoder.direction === 0)
      .sort((a, b) => a.index - b.index)
      .map((knob) => {
        const assigned = snapshot.encoders[view.displayLayer]?.[knob.index]
        return {
          index: knob.index,
          ccw: assigned?.[0] !== undefined ? `↺ ${labelOf(assigned[0])}` : '',
          cw: assigned?.[1] !== undefined ? `↻ ${labelOf(assigned[1])}` : ''
        }
      })
    return layoutEncoderStrip({
      items,
      keyBounds: geometry.keyBounds,
      placement: encoderPlacement,
      unit,
      fontSize: ENCODER_FONT
    })
  }, [
    geometry.encoders,
    geometry.keyBounds,
    snapshot.encoders,
    view.displayLayer,
    labelOf,
    encoderPlacement,
    unit
  ])

  const viewBox = viewBoxFor(geometry.keyBounds, strip, encoderPlacement, unit)

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-full"
      role="img"
      style={{ '--trigger': layerColor(view.displayLayer) } as React.CSSProperties}
      aria-label={`レイヤー ${view.displayLayer}${layerNames[view.displayLayer] ? `(${layerNames[view.displayLayer]})` : ''} のキーマップ`}
    >
      {/* 回転は matrix に出ないので押下表示はできない。割り当てだけ出す */}
      {strip?.items.map((item) => (
        <g key={`enc-${item.index}`} className="encoder-item">
          <circle className="encoder" cx={item.dotX} cy={strip.y} r={strip.dotRadius} />
          <text className="encoder-label" x={item.ccwX} y={strip.y}>
            {item.ccw}
          </text>
          <text className="encoder-label" x={item.cwX} y={strip.y}>
            {item.cw}
          </text>
        </g>
      ))}

      {keys.map((physical) => {
        const id = keyId(physical.row, physical.col)
        const resolved = engine.resolveKey(physical.row, physical.col, view)
        const held = layers.held.get(id)
        // 押しているキーは、押した瞬間に確定したキーコードで描く(QMK と同じく、離すまで変わらない)。
        // 表示中のレイヤーで引き直すと、TD で L4 に入ったとき L4 のその位置(TD ではない)を引いてしまい、
        // 長押しレイヤーが分からず「Lnull 長押し中」になっていた
        const keycode = held?.keycode ?? resolved.effective
        const label = labelForKeycode(keycode, labelMode, labelContext)
        const holdLayer = held ? held.holdLayer : holdLayerOf(keycode, snapshot.tapDance)

        return (
          <KeyCap
            key={id}
            physical={physical}
            label={label}
            keycode={keycode}
            holdLayer={holdLayer}
            holdLayerName={holdLayer !== null ? layerNames[holdLayer] : undefined}
            pressed={held !== undefined}
            holding={held?.holdActive === true}
            // 押しているキーは押した瞬間の値を出しているので、透過をたどった体(薄い表示)にしない
            transparent={held ? false : resolved.transparent}
            unlockHint={unlockSet.has(id)}
            highlight={highlightSet.has(id)}
            shifted={shifted}
            unit={unit}
            onClick={onKeyClick && (() => onKeyClick(physical.row, physical.col))}
          />
        )
      })}
    </svg>
  )
}
