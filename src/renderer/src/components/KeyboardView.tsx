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
  unit?: number
}

export function KeyboardView({
  geometry,
  snapshot,
  engine,
  layers,
  labelMode,
  unlockKeys = [],
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

  const { minX, minY, maxX, maxY } = geometry.bounds
  const pad = 0.2
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
      {geometry.encoders
        .filter((encoder) => encoder.direction === 0)
        .map((encoder) => {
          const cx = (encoder.x + encoder.width / 2) * unit
          const cy = (encoder.y + encoder.height / 2) * unit
          const r = (Math.min(encoder.width, encoder.height) / 2) * unit * 0.8
          const assigned = snapshot.encoders[layers.displayLayer]?.[encoder.index]
          const ccw = assigned ? labelOf(assigned[0]) : ''
          const cw = assigned ? labelOf(assigned[1]) : ''
          return (
            <g
              key={`enc-${encoder.index}`}
              transform={
                encoder.rotationAngle !== 0
                  ? `rotate(${encoder.rotationAngle} ${encoder.rotationX * unit} ${encoder.rotationY * unit})`
                  : undefined
              }
            >
              <circle className="encoder" cx={cx} cy={cy} r={r} />
              {/* 回転は matrix に出ないので押下表示はできない。割り当てだけ出す */}
              <text className="sub" x={cx} y={cy - 6}>
                {ccw ? `↺ ${ccw}` : ''}
              </text>
              <text className="sub" x={cx} y={cy + 7}>
                {cw ? `↻ ${cw}` : ''}
              </text>
            </g>
          )
        })}

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
