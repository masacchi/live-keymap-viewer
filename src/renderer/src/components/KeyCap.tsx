/**
 * キー 1 個の描画。
 *
 * 見た目は reference/keymap-preview.html に合わせてある:
 * 記号キーは色を変える、透過は薄く、長押しでレイヤーが出るキーは下端に色帯、
 * 押されているレイヤーキーは「押下中」と出す。
 */
import type { JSX } from 'react'
import type { Keycode } from '../keycodes/decode'
import type { KeyLabel } from '../keycodes/labels'
import type { PhysicalKey } from '../layout/geometry'

export interface KeyCapProps {
  physical: PhysicalKey
  label: KeyLabel
  keycode: Keycode
  /** このキーを長押しすると出るレイヤー。無ければ null。 */
  holdLayer: number | null
  pressed: boolean
  /** 押されていて、かつ長押しレイヤーが有効になっているか。 */
  holding: boolean
  transparent: boolean
  /** アンロックのために押すべきキーか。 */
  unlockHint: boolean
  unit: number
}

const GAP = 0.08
const BAND_HEIGHT = 15

function mainFontSize(text: string): number {
  const length = [...text].length
  if (/[ぁ-んァ-ヶ一-龥]/.test(text)) return length <= 2 ? 14 : 11
  if (length === 1) return 20
  if (length <= 3) return 15
  if (length <= 5) return 12
  return 10
}

export function KeyCap({
  physical,
  label,
  keycode,
  holdLayer,
  pressed,
  holding,
  transparent,
  unlockHint,
  unit
}: KeyCapProps): JSX.Element {
  const x = (physical.x + GAP / 2) * unit
  const y = (physical.y + GAP / 2) * unit
  const width = (physical.width - GAP) * unit
  const height = (physical.height - GAP) * unit
  const cx = x + width / 2
  const cy = y + height / 2

  const classes = ['key']
  if (label.category === 'sym') classes.push('key-sym')
  if (label.category === 'none' && label.main === '') classes.push('key-none')
  if (transparent) classes.push('key-trns')
  if (pressed) classes.push('key-pressed')
  if (unlockHint) classes.push('key-unlock')

  const rotate =
    physical.rotationAngle !== 0
      ? `rotate(${physical.rotationAngle} ${physical.rotationX * unit} ${physical.rotationY * unit})`
      : undefined

  const showBand = holdLayer !== null && !transparent
  const hasSub = Boolean(label.sub) && !showBand
  const mainY = cy - (showBand ? 6 : 0) - (hasSub ? 5 : 0)

  return (
    <g className={classes.join(' ')} transform={rotate}>
      <rect className="cap" x={x} y={y} width={width} height={height} rx={7} />

      {holding ? (
        <>
          <text className="main" x={cx} y={cy - 6} fontSize={12}>
            押下中
          </text>
          <text className="sub" x={cx} y={cy + 11}>
            {`${label.main} 長押し`}
          </text>
        </>
      ) : (
        <>
          {label.main !== '' && (
            <text className="main" x={cx} y={mainY} fontSize={mainFontSize(label.main)}>
              {label.main}
            </text>
          )}
          {label.shift && (
            <text className="shift" x={x + 5} y={y + 4}>
              {label.shift}
            </text>
          )}
          {hasSub && (
            <text className="sub" x={cx} y={mainY + 15}>
              {label.sub}
            </text>
          )}
          {showBand && (
            <>
              <rect
                className="band"
                x={x}
                y={y + height - BAND_HEIGHT}
                width={width}
                height={BAND_HEIGHT}
                rx={6}
                fill={`var(--layer-${holdLayer % 10})`}
              />
              <text className="band-text" x={cx} y={y + height - BAND_HEIGHT / 2}>
                {`長押し→L${holdLayer}`}
              </text>
            </>
          )}
        </>
      )}

      <title>{describe(keycode, label)}</title>
    </g>
  )
}

function describe(keycode: Keycode, label: KeyLabel): string {
  const parts = [label.main || '(なし)']
  if (label.shift) parts.push(`Shift: ${label.shift}`)
  if (label.sub) parts.push(label.sub)
  parts.push(`raw 0x${keycode.raw.toString(16).padStart(4, '0')}`)
  return parts.join(' / ')
}
