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
        .map((encoder) => (
          <circle
            key={`enc-${encoder.index}`}
            className="encoder"
            cx={(encoder.x + encoder.width / 2) * unit}
            cy={(encoder.y + encoder.height / 2) * unit}
            r={(Math.min(encoder.width, encoder.height) / 2) * unit * 0.8}
            transform={
              encoder.rotationAngle !== 0
                ? `rotate(${encoder.rotationAngle} ${encoder.rotationX * unit} ${encoder.rotationY * unit})`
                : undefined
            }
          />
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
