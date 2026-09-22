/**
 * キー 1 個の描画。
 *
 * 見た目は reference/keymap-preview.html に合わせてある:
 * 記号キーは色を変える、透過は薄く、長押しでレイヤーが出るキーは下端に色帯、
 * 押されているレイヤーキーは「押下中」と出す。
 */
import { clsx } from 'clsx'
import type { JSX } from 'react'
import type { Keycode } from '../keycodes/decode'
import type { KeyLabel } from '../keycodes/labels'
import type { PhysicalKey } from '../layout/geometry'
import { layerColor } from '../lib/theme'

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

/** キーの幅から引く、文字の左右の余白(合計)。 */
const TEXT_PADDING = 8
/** 収まらないときに縮めてよい下限(px)。これより小さいと読めない。 */
const MIN_FONT = 8
/** 補足行の文字の大きさ(px)。styles.css の .sub と揃える。 */
const SUB_FONT = 9
/** 2 行に割ったときの字の大きさの上限。2 行ぶんの高さに収めるため。 */
const TWO_LINE_FONT = 12

/** 空白のうち、2 つに割ったとき長い方が一番短くなる位置で割る。空白が無ければ null。 */
function splitInTwo(text: string): [string, string] | null {
  const words = text.split(' ').filter(Boolean)
  if (words.length < 2) return null
  let best: [string, string] | null = null
  for (let i = 1; i < words.length; i++) {
    const pair: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    const longest = (p: [string, string]) => Math.max(textWidth(p[0], 1), textWidth(p[1], 1))
    if (best === null || longest(pair) < longest(best)) best = pair
  }
  return best
}

interface FittedText {
  lines: string[]
  fontSize: number
  /** 下限まで縮めても収まらなかったら false(呼び出し側で別の文言に替えるため)。 */
  fits: boolean
}

/**
 * 主文字をキーの幅に収める。1 行で入らなければ空白で 2 行に割り、それでも入らなければ
 * 字を小さくする。カスタムキーの名前("Switch Output" など)がキーの外にはみ出していた。
 */
function fitMain(text: string, width: number, maxFont = Number.POSITIVE_INFINITY): FittedText {
  const room = width - TEXT_PADDING
  const preferred = Math.min(maxFont, mainFontSize(text))
  if (textWidth(text, preferred) <= room) return { lines: [text], fontSize: preferred, fits: true }

  const lines = splitInTwo(text) ?? [text]
  const widest = (size: number) => Math.max(...lines.map((line) => textWidth(line, size)))
  let fontSize = lines.length === 2 ? Math.min(preferred, TWO_LINE_FONT) : preferred
  while (fontSize > MIN_FONT && widest(fontSize) > room) fontSize--
  return { lines, fontSize, fits: widest(fontSize) <= room }
}

/** 補足行の文字の大きさ。幅に収まらなければ下限まで縮める。 */
function subFontSize(text: string, width: number): number {
  const room = width - TEXT_PADDING
  let size = SUB_FONT
  while (size > MIN_FONT - 1 && textWidth(text, size) > room) size--
  return size
}

/**
 * 長押し中のキーの補足。キーの名前も添えたいが、1u には「Space 長押し中」が収まらない
 * (はみ出していた)。入らなければ「長押し中」だけにする。キーの名前はツールチップにある。
 */
function holdingSub(keyName: string, width: number): string {
  const full = `${keyName} 長押し中`.trim()
  return textWidth(full, SUB_FONT) <= width - TEXT_PADDING ? full : '長押し中'
}

/** 複数行の文字を、中心の y に揃えて縦に並べる。1 行なら tspan を使わない。 */
function Lines({ lines, x, fontSize }: { lines: string[]; x: number; fontSize: number }) {
  if (lines.length === 1) return <>{lines[0]}</>
  const lineHeight = fontSize * 1.15
  return (
    <>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行の並びは変わらない
        <tspan key={i} x={x} dy={i === 0 ? (-lineHeight * (lines.length - 1)) / 2 : lineHeight}>
          {line}
        </tspan>
      ))}
    </>
  )
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

  // Shift 中は、Shift で入る文字を主文字の位置に大きく出し、ふだんの文字を上に退かせる
  const swapShift = shifted && Boolean(label.shift)
  // styles.css のキーキャップのクラス(Tailwind ではない)なので、tailwind-merge は通さない。
  // 効く順番はここでの並びではなく styles.css の並び(基本 → 種類 → 状態)で決まる
  const className = clsx('key', {
    'key-sym': label.category === 'sym',
    'key-none': label.category === 'none' && label.main === '',
    'key-trns': transparent,
    'key-pressed': pressed,
    // レイヤーを出しているキーは、そのレイヤーの色で塗る。
    // 「いまどのキーのせいでこのレイヤーなのか」が一目で分かるように。
    'key-holding': holding,
    'key-unlock': unlockHint,
    'key-shifted': swapShift,
    'key-clickable': onClick !== undefined
  })
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

  const holdColor = holdLayer !== null ? layerColor(holdLayer) : undefined

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
  const fitted = fitMain(mainText, width)
  // 2 行に割ったときは、補足行を 2 行目の下まで下げる
  const extraLines = (fitted.lines.length - 1) * fitted.fontSize * 1.15
  const mainY = (hasShift ? contentCenter + 6 : contentCenter) - (hasSub ? 5 + extraLines / 2 : 0)
  const subY = mainY + 15 + extraLines / 2

  // 長押し中の表示。レイヤー名が収まらなければ番号に戻す(色でどのレイヤーかは分かる)
  const namedTitle = holdLayerName ? fitMain(holdLayerName, width, 13) : null
  const holdTitle =
    holdLayer === null ? null : namedTitle?.fits ? namedTitle : fitMain(`L${holdLayer}`, width, 13)

  return (
    <g
      className={className}
      transform={rotate}
      style={{ '--hold': holdColor } as React.CSSProperties}
      {...interactive}
    >
      <rect className="cap" x={x} y={y} width={width} height={height} rx={7} />

      {holding && holdTitle ? (
        <>
          <text className="main" x={cx} y={cy - 9} fontSize={holdTitle.fontSize}>
            <Lines lines={holdTitle.lines} x={cx} fontSize={holdTitle.fontSize} />
          </text>
          <text className="sub" x={cx} y={cy + 8}>
            {holdingSub(label.main, width)}
          </text>
        </>
      ) : (
        <>
          {mainText !== '' && (
            <text className="main" x={cx} y={mainY} fontSize={fitted.fontSize}>
              <Lines lines={fitted.lines} x={cx} fontSize={fitted.fontSize} />
            </text>
          )}
          {hasShift && (
            <text className="shift" x={cx} y={shiftY}>
              {shiftText}
            </text>
          )}
          {hasSub && label.sub && (
            // .sub の font-size は CSS にあるので、属性ではなく style で上書きする(属性は CSS に負ける)
            <text
              className="sub"
              x={cx}
              y={subY}
              style={{ fontSize: subFontSize(label.sub, width) }}
            >
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
                fill={layerColor(holdLayer)}
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
  if (label.description) parts.push(label.description)
  parts.push(`raw 0x${keycode.raw.toString(16).padStart(4, '0')}`)
  return parts.join(' / ')
}
