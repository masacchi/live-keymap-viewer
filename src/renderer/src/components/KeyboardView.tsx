/** キーボード全体の SVG。物理配置は定義の KLE から来るので固定データは持たない。 */
import { useMemo, type JSX } from 'react'
import type { LayerEngine, LayerSnapshot } from '../engine/layerState'
import { decodeKeycode } from '../keycodes/decode'
import { labelForKeycode, type LabelContext, type LabelMode } from '../keycodes/labels'
import { keyId, visibleKeys, type KeyboardGeometry } from '../layout/geometry'
import { decodeLayoutOptions } from '../layout/layoutOptions'
import type { KeyboardSnapshot } from '../hid/vial'
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
  encoderPlacement?: 'top' | 'bottom'
  unit?: number
}

/** ノブの割り当て文字の大きさ(px)。 */
const ENCODER_FONT = 13
/** ノブの帯の高さ(1u 単位)。 */
const ENCODER_STRIP = 0.8

/**
 * SVG には文字幅を測る手立てが無いので見積もる。
 * 全角はほぼ 1em、それ以外は 0.58em として扱えば、中央揃えには十分。
 */
function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text) {
    width += /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58
  }
  return width
}

export function KeyboardView({
  geometry,
  snapshot,
  engine,
  layers,
  labelMode,
  unlockKeys = [],
  encoderPlacement = 'bottom',
  unit = 58
}: KeyboardViewProps): JSX.Element {
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

  const unlockSet = useMemo(
    () => new Set(unlockKeys.map((k) => keyId(k.row, k.col))),
    [unlockKeys]
  )

  /*
   * ノブは KLE 上の座標では描かない。
   *
   * Cornix LP の定義はエンコーダーを図の右端にまとめて置いてあり、そのまま描くと
   * キーボードの横幅が 1.3 倍ほどに間延びする。位置に意味は無い(回転は matrix に
   * 出ないので押下表示もできない)ので、キーの上か下に横一列でまとめる。
   */
  const strip = useMemo(() => {
    const knobs = geometry.encoders
      .filter((encoder) => encoder.direction === 0)
      .sort((a, b) => a.index - b.index)
    if (knobs.length === 0) return null

    const dotRadius = 0.16 * unit
    const innerGap = 0.16 * unit
    const itemGap = 0.5 * unit

    const items = knobs.map((knob) => {
      const assigned = snapshot.encoders[layers.displayLayer]?.[knob.index]
      const ccw = assigned?.[0] !== undefined ? `↺ ${labelOf(assigned[0])}` : ''
      const cw = assigned?.[1] !== undefined ? `↻ ${labelOf(assigned[1])}` : ''
      const width =
        dotRadius * 2 +
        innerGap +
        estimateTextWidth(ccw, ENCODER_FONT) +
        innerGap * 2 +
        estimateTextWidth(cw, ENCODER_FONT)
      return { index: knob.index, ccw, cw, width }
    })

    const total = items.reduce((sum, item) => sum + item.width, 0) + itemGap * (items.length - 1)
    const centerX = ((geometry.keyBounds.minX + geometry.keyBounds.maxX) / 2) * unit
    const y =
      (encoderPlacement === 'top'
        ? geometry.keyBounds.minY - ENCODER_STRIP / 2
        : geometry.keyBounds.maxY + ENCODER_STRIP / 2) * unit

    let cursor = centerX - total / 2
    const placed = items.map((item) => {
      const x = cursor
      cursor += item.width + itemGap
      return {
        ...item,
        dotX: x + dotRadius,
        ccwX: x + dotRadius * 2 + innerGap,
        cwX:
          x + dotRadius * 2 + innerGap + estimateTextWidth(item.ccw, ENCODER_FONT) + innerGap * 2
      }
    })
    return { items: placed, y, dotRadius, minX: centerX - total / 2, maxX: centerX + total / 2 }
  }, [geometry.encoders, geometry.keyBounds, snapshot.encoders, layers.displayLayer, labelOf, encoderPlacement, unit])

  const pad = 0.2
  const minX = Math.min(geometry.keyBounds.minX, strip ? strip.minX / unit : Infinity)
  const maxX = Math.max(geometry.keyBounds.maxX, strip ? strip.maxX / unit : -Infinity)
  const minY = geometry.keyBounds.minY - (encoderPlacement === 'top' && strip ? ENCODER_STRIP : 0)
  const maxY = geometry.keyBounds.maxY + (encoderPlacement === 'bottom' && strip ? ENCODER_STRIP : 0)
  const viewBox = [
    (minX - pad) * unit,
    (minY - pad) * unit,
    (maxX - minX + pad * 2) * unit,
    (maxY - minY + pad * 2) * unit
  ].join(' ')

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-full"
      role="img"
      aria-label={`レイヤー ${layers.displayLayer} のキーマップ`}
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
        const resolved = engine.resolveKey(physical.row, physical.col, layers)
        const held = layers.held.get(id)
        const label = labelForKeycode(resolved.effective, labelMode, labelContext)
        const holdLayer = holdLayerOf(resolved.effective, snapshot)

        return (
          <KeyCap
            key={id}
            physical={physical}
            label={label}
            keycode={resolved.effective}
            holdLayer={holdLayer}
            pressed={held !== undefined}
            holding={held?.holdActive === true}
            transparent={resolved.transparent}
            unlockHint={unlockSet.has(id)}
            unit={unit}
          />
        )
      })}
    </svg>
  )
}

/** キーコードから「長押しで出るレイヤー」を取り出す(帯の表示用)。 */
function holdLayerOf(
  keycode: ReturnType<typeof decodeKeycode>,
  snapshot: KeyboardSnapshot
): number | null {
  if (keycode.kind === 'layerTap') return keycode.layer
  if (keycode.kind === 'layer' && keycode.op === 'MO') return keycode.layer
  if (keycode.kind === 'tapDance') {
    const entry = snapshot.tapDance[keycode.index]
    if (!entry) return null
    const hold = decodeKeycode(entry.onHold)
    if (hold.kind === 'layer' && hold.op === 'MO') return hold.layer
  }
  return null
}
