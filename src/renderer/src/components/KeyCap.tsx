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
  /** そのレイヤーの名前。無ければ番号で出す。 */
  holdLayerName?: string
  pressed: boolean
  /** 押されていて、かつ長押しレイヤーが有効になっているか。 */
  holding: boolean
  transparent: boolean
  /** アンロックのために押すべきキーか。 */
  unlockHint: boolean
  /** Shift が効いているか。Shift で入る文字が変わるキーは、そちらを主にして目立たせる。 */
  shifted?: boolean
  unit: number
  onClick?: () => void
}

const GAP = 0.08
const BAND_HEIGHT = 15
/** 色帯の文字の大きさ(px)。styles.css の .band-text と揃える。 */
const BAND_FONT = 9

/** おおよその文字幅。全角は字の大きさ、半角はその 6 割として数える。 */
function textWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text)
    width += /[\u2190-\u21ff\u3000-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.6
  return width
}

/**
 * 長押しの色帯の文字。名前があれば名前で出し、キーの幅に収まらなければ短くする。
 * 名前が長すぎるときは番号に戻す(色でどのレイヤーかは分かる)。
 */
function bandText(layer: number, name: string | undefined, width: number): string {
  for (const text of name ? [`長押し→${name}`, `→${name}`] : []) {
    if (textWidth(text, BAND_FONT) <= width - 6) return text
  }
  return `長押し→L${layer}`
}

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
  holdLayerName,
  pressed,
  holding,
  transparent,
  unlockHint,
  shifted = false,
  unit,
  onClick
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
  // レイヤーを出しているキーは、そのレイヤーの色で塗る。
  // 「いまどのキーのせいでこのレイヤーなのか」が一目で分かるように。
  if (holding) classes.push('key-holding')
  if (unlockHint) classes.push('key-unlock')
  // Shift 中は、Shift で入る文字を主文字の位置に大きく出し、ふだんの文字を上に退かせる
  const swapShift = shifted && Boolean(label.shift)
  if (swapShift) classes.push('key-shifted')
  if (onClick) classes.push('key-clickable')
  const mainText = swapShift ? (label.shift ?? '') : label.main
  const shiftText = swapShift ? label.main : label.shift

  // クリックできるとき(モック)だけボタンとして振る舞う。キーボードでも Enter / Space で押せる
  const interactive = onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onClick()
        }
      }
    : {}

  const holdColor = holdLayer !== null ? `var(--layer-${holdLayer % 10})` : undefined

  const rotate =
    physical.rotationAngle !== 0
      ? `rotate(${physical.rotationAngle} ${physical.rotationX * unit} ${physical.rotationY * unit})`
      : undefined

  const showBand = holdLayer !== null && !transparent
  const hasSub = Boolean(label.sub) && !showBand
  const hasShift = Boolean(shiftText)

  // 色帯を除いた、文字を置ける範囲の真ん中
  const contentBottom = y + height - (showBand ? BAND_HEIGHT : 0)
  const contentCenter = (y + contentBottom) / 2
  // Shift 側の文字は、キーキャップの印字と同じように主文字の「上」に置く。
  // 左上に小さく出していたときは見落としやすかった。
  const shiftY = y + 13
  const mainY = (hasShift ? contentCenter + 6 : contentCenter) - (hasSub ? 5 : 0)

  return (
    <g
      className={classes.join(' ')}
      transform={rotate}
      style={{ '--hold': holdColor } as React.CSSProperties}
      {...interactive}
    >
      <rect className="cap" x={x} y={y} width={width} height={height} rx={7} />

      {holding ? (
        <>
          <text
            className="main"
            x={cx}
            y={cy - 9}
            fontSize={holdLayerName ? Math.min(13, mainFontSize(holdLayerName)) : 13}
          >
            {holdLayerName || `L${holdLayer}`}
          </text>
          <text className="sub" x={cx} y={cy + 8}>
            {`${label.main} 長押し中`}
          </text>
        </>
      ) : (
        <>
          {mainText !== '' && (
            <text className="main" x={cx} y={mainY} fontSize={mainFontSize(mainText)}>
              {mainText}
            </text>
          )}
          {hasShift && (
            <text className="shift" x={cx} y={shiftY}>
              {shiftText}
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
                {bandText(holdLayer, holdLayerName, width)}
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
