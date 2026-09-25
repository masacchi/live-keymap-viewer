/** キーボード全体のSVG。物理配置は定義のKLEから来るので固定データは持たない。 */
import { type JSX, useMemo } from 'react'
import type { LayerEngine, LayerSnapshot } from '../engine/layerState'
import type { KeyboardSnapshot } from '../hid/vial'
import { decodeKeycode, MOD_SHIFT } from '../keycodes/decode'
import { type LabelContext, type LabelMode, labelForKeycode } from '../keycodes/labels'
import { holdLayerOf } from '../keycodes/tapDance'
import { layoutEncoderStrip, viewBoxFor } from '../layout/encoderStrip'
import { type KeyboardGeometry, keyId, visibleKeys } from '../layout/geometry'
import { knobButtonsFor } from '../layout/knobButtons'
import { decodeLayoutOptions } from '../layout/layoutOptions'
import { layerColor } from '../lib/theme'
import { joinWords, messages } from '../messages'
import { KeyCap } from './KeyCap'

export interface KeyboardViewProps {
  geometry: KeyboardGeometry
  snapshot: KeyboardSnapshot
  engine: LayerEngine
  layers: LayerSnapshot
  labelMode: LabelMode
  /** アンロックのために押すべきキー。ロック中だけ渡す。 */
  unlockKeys?: Array<{ row: number; col: number }>
  unit?: number
  /** キーをクリックしたとき。モックでキーを押す/離すのに使う(実機では渡さない)。 */
  onKeyClick?: (row: number, col: number) => void
  /**
   * 実際の状態とは別に、このレイヤーを図に出す(プレビュー)。透過のキーは既定レイヤーの
   * 値をたどる。押しているキーの表示は実際の状態のまま。
   */
  previewLayer?: number | null
  /** レイヤーの名前(番号順、''は名前なし)。長押しの色帯などに使う。 */
  layerNames?: readonly string[]
  /**
   * 縁取るキー。プレビュー中に、そのレイヤーに入るキー(Spaceなど)を示すのに使う。
   * 色は図に出しているレイヤーの色。
   */
  highlightKeys?: ReadonlyArray<{ row: number; col: number }>
  /** 光らせるキー。記号の出し方で選んだ記号を打つのに押すキー(Shiftも含む)。 */
  flashKeys?: ReadonlyArray<{ row: number; col: number }>
}

/** ノブの割り当て文字の大きさ(px)。styles.cssの.encoder-labelと揃える。 */
const ENCODER_FONT = 13

export function KeyboardView({
  geometry,
  snapshot,
  engine,
  layers,
  labelMode,
  unlockKeys = [],
  unit = 58,
  onKeyClick,
  previewLayer = null,
  layerNames = [],
  highlightKeys = [],
  flashKeys = []
}: KeyboardViewProps): JSX.Element {
  // Shiftを押しているあいだは、Shiftで入る文字の方を目立たせる
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

  // ノブの割り当ては"↑"だけだと何の↑か分からないので、短いものには補足を足す
  const labelOf = useMemo(
    () =>
      (raw: number): string => {
        const label = labelForKeycode(decodeKeycode(raw), labelMode, labelContext)
        if (label.sub && [...label.main].length <= 2) return joinWords(label.main, label.sub)
        return label.main
      },
    [labelMode, labelContext]
  )

  const unlockSet = useMemo(() => new Set(unlockKeys.map((k) => keyId(k.row, k.col))), [unlockKeys])
  const flashSet = useMemo(() => new Set(flashKeys.map((k) => keyId(k.row, k.col))), [flashKeys])
  const highlightSet = useMemo(
    () => new Set(highlightKeys.map((k) => keyId(k.row, k.col))),
    [highlightKeys]
  )

  /**
   * ノブの割り当て(図に出しているレイヤーの)。押し込みキーが分かるノブはそのキーに付けて、
   * キーを円く描き、上下に挟んで出す。分からないものは図の下にまとめる(同じ上下の形で)
   */
  const knobs = useMemo(() => {
    const buttons = knobButtonsFor(snapshot.definition)
    const onKeys = new Map<string, { ccw: string; cw: string; inward: 'left' | 'right' }>()
    const centerX = (geometry.keyBounds.minX + geometry.keyBounds.maxX) / 2
    const rest: Array<{ index: number; ccw: string; cw: string }> = []
    for (const knob of geometry.encoders
      .filter((encoder) => encoder.direction === 0)
      .sort((a, b) => a.index - b.index)) {
      const assigned = snapshot.encoders[view.displayLayer]?.[knob.index]
      const labels = {
        index: knob.index,
        ccw: assigned?.[0] !== undefined ? `↺ ${labelOf(assigned[0])}` : '',
        cw: assigned?.[1] !== undefined ? `↻ ${labelOf(assigned[1])}` : ''
      }
      const button = buttons.find((b) => b.index === knob.index)
      const id = button && keyId(button.row, button.col)
      // 押し込みキーが図に出ていなければ(レイアウトの選択で隠れているなど)、下にまとめる
      const key = id ? keys.find((k) => keyId(k.row, k.col) === id) : undefined
      if (id && key) {
        // 図の中央がキーのどちら側か。キーの幅に収まらない割り当ての文字は、そちらへ伸ばす
        const inward = key.x + key.width / 2 > centerX ? 'left' : 'right'
        onKeys.set(id, { ccw: labels.ccw, cw: labels.cw, inward })
      } else rest.push(labels)
    }
    const strip = layoutEncoderStrip({
      items: rest,
      keyBounds: geometry.keyBounds,
      unit,
      fontSize: ENCODER_FONT
    })
    return { onKeys, strip }
  }, [
    snapshot.definition,
    snapshot.encoders,
    keys,
    geometry.encoders,
    geometry.keyBounds,
    view.displayLayer,
    labelOf,
    unit
  ])
  const { strip } = knobs

  const viewBox = viewBoxFor(geometry.keyBounds, strip, unit)

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-full"
      role="img"
      style={{ '--trigger': layerColor(view.displayLayer) } as React.CSSProperties}
      aria-label={messages.keyboardView.label(view.displayLayer, layerNames[view.displayLayer])}
    >
      {/* 回転はmatrixに出ないので押下表示はできない。割り当てだけ出す */}
      {strip?.items.map((item) => (
        <g key={`enc-${item.index}`} className="encoder-item">
          <text className="encoder-label" x={item.x} y={strip.cwY}>
            {item.cw}
          </text>
          <circle className="encoder" cx={item.x} cy={strip.y} r={strip.dotRadius} />
          <text className="encoder-label" x={item.x} y={strip.ccwY}>
            {item.ccw}
          </text>
        </g>
      ))}

      {keys.map((physical) => {
        const id = keyId(physical.row, physical.col)
        const resolved = engine.resolveKey(physical.row, physical.col, view)
        const held = layers.held.get(id)
        // 押しているキーは、押した瞬間に確定したキーコードで描く(QMKと同じく、離すまで変わらない)。
        // 表示中のレイヤーで引き直すと、TDでL4に入ったときL4のその位置(TDではない)を引いてしまい、
        // 長押しレイヤーが分からなくなる(「Lnull長押し中」と出てしまう)
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
            flash={flashSet.has(id)}
            shifted={shifted}
            knob={knobs.onKeys.get(id)}
            unit={unit}
            onClick={onKeyClick && (() => onKeyClick(physical.row, physical.col))}
          />
        )
      })}
    </svg>
  )
}
