/**
 * キー1個の描画。
 *
 * 見た目はreference/keymap-preview.htmlをもとにしている:
 * 記号キーは一段明るい面、透過は薄く、長押しでレイヤーが出るキーは下端に色帯、
 * 押されているレイヤーキーは「長押し中」と出す。
 *
 * 色の意味は1色に1つ: 色味(色相)はレイヤー、黄は押下、白い実線の枠はShiftで変わるキー、
 * 白い破線(回る)はアンロックで押すキー。styles.cssのトークンを参照。
 */
import { clsx } from 'clsx'
import type { JSX } from 'react'
import type { Keycode } from '../keycodes/decode'
import type { KeyLabel } from '../keycodes/labels'
import type { PhysicalKey } from '../layout/geometry'
import { layerColor } from '../lib/theme'
import { joinWords, messages } from '../messages'

export interface KeyCapProps {
  physical: PhysicalKey
  label: KeyLabel
  keycode: Keycode
  /** このキーを長押しすると出るレイヤー。無ければnull。 */
  holdLayer: number | null
  /** そのレイヤーの名前。無ければ番号で出す。 */
  holdLayerName?: string
  pressed: boolean
  /** 押されていて、かつ長押しレイヤーが有効になっているか。 */
  holding: boolean
  transparent: boolean
  /** アンロックのために押すべきキーか。 */
  unlockHint: boolean
  /** 縁取るか(プレビュー中の、そのレイヤーに入るキー)。色は--trigger。 */
  highlight?: boolean
  /** 光らせるか(記号の出し方で選んだ記号を打つのに押すキー)。 */
  flash?: boolean
  /** Shiftが効いているか。Shiftで入る文字が変わるキーは、そちらを主にして目立たせる。 */
  shifted?: boolean
  /**
   * ノブの押し込みキーなら、回したときの割り当て(「↺ 音量−」「↻ 音量+」)。
   * キーを円く描き、右回りを上、左回りを下に挟んで出す(layout/knobButtons.ts)。
   * 右回りが上なのは、音量なら「音量+」が上に来るように(上げる向きが上)
   * inwardは図の中央がどちらにあるか。キーの幅に収まらない文字はそちらへ伸ばす
   */
  knob?: { ccw: string; cw: string; inward: 'left' | 'right' }
  unit: number
  onClick?: () => void
}

const GAP = 0.08
/** キーの厚みとして下に覗かせる縁(px)。押したときの沈み(styles.cssの.key-body)より少し深く。 */
const SKIRT = 3
const BAND_HEIGHT = 17
/**
 * 色帯をキーの縁から内側へ寄せる幅(px)。外枠いっぱいに描くと帯がキーからはみ出しそうに
 * 見えるので、少し寄せてキーキャップの中のラベルに見せる
 */
const BAND_INSET = 2
/** ノブの割り当ての文字の縦中心を、キーの縁(下は厚みの縁)からどれだけ離すか(px)。 */
const KNOB_LABEL_OFFSET = 11
/** 円いキーで文字を置ける幅の割合。四隅が無いぶん狭い。 */
const KNOB_TEXT_ROOM = 0.78
/** ノブの割り当ての文字の大きさ(px)。styles.cssの.encoder-labelと揃える。 */
const KNOB_FONT = 13
/** 色帯の文字の大きさ(px)。styles.cssの.band-textと揃える。 */
const BAND_FONT = 11

/** おおよその文字幅。全角は字の大きさ、半角はその6割として数える。 */
function textWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text)
    width += /[\u2190-\u21ff\u3000-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.6
  return width
}

/**
 * 長押しの色帯の文字。行き先のレイヤーだけを書く(「L2記号」→「記号」→「L2」の順に、入るもの)。
 *
 * 「長押し→L2」まで書くと9pxでも1uにぎりぎりで、傾いた親指キーでは読めない。「長押しで」の部分は
 * ツールバーの一覧(L2 Space長押し)とツールチップで分かるので、帯は行き先だけにして字を大きくする。
 * 色でもどのレイヤーかは分かる。
 */
function bandText(layer: number, name: string | undefined, width: number): string {
  for (const text of name ? [joinWords(`L${layer}`, name), name] : []) {
    if (textWidth(text, BAND_FONT) <= width - 6) return text
  }
  return `L${layer}`
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
/** 補足行の文字の大きさ(px)。styles.cssの.subと揃える。 */
const SUB_FONT = 9
/** 2行に割ったときの字の大きさの上限。2行ぶんの高さに収めるため。 */
const TWO_LINE_FONT = 12

/** 空白のうち、2つに割ったとき長い方が一番短くなる位置で割る。空白が無ければnull。 */
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
  /** 下限まで縮めても収まらなかったらfalse(呼び出し側で別の文言に替えるため)。 */
  fits: boolean
}

/**
 * 主文字をキーの幅に収める。1行で入らなければ空白で2行に割り、それでも入らなければ
 * 字を小さくする(カスタムキーの名前("Switch Output"など)がキーの外にはみ出さないように)。
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
 * 長押し中のキーの補足。キーの名前も添えたいが、1uには「Space長押し中」が収まらないことがある。
 * 入らなければ「長押し中」だけにする。キーの名前はツールチップにある。
 */
function holdingSub(keyName: string, width: number): string {
  const full = messages.keyCap.holdingKey(keyName)
  return textWidth(full, SUB_FONT) <= width - TEXT_PADDING ? full : messages.keyCap.holding
}

/** 複数行の文字を、中心のyに揃えて縦に並べる。1行ならtspanを使わない。 */
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
  highlight = false,
  flash = false,
  shifted = false,
  knob,
  unit,
  onClick
}: KeyCapProps): JSX.Element {
  const x = (physical.x + GAP / 2) * unit
  const y = (physical.y + GAP / 2) * unit
  const width = (physical.width - GAP) * unit
  const height = (physical.height - GAP) * unit
  const cx = x + width / 2
  const cy = y + height / 2

  // Shift中は、Shiftで入る文字を主文字の位置に大きく出し、ふだんの文字を上に退かせる
  const swapShift = shifted && Boolean(label.shift)
  // styles.cssのキーキャップのクラス(Tailwindではない)なので、tailwind-mergeは通さない。
  // 効く順番はここでの並びではなくstyles.cssの並び(基本 → 種類 → 状態)で決まる
  const className = clsx('key', {
    'key-sym': label.category === 'sym',
    'key-none': label.category === 'none' && label.main === '',
    'key-trns': transparent,
    'key-pressed': pressed,
    // レイヤーを出しているキーは、そのレイヤーの色で塗る。
    // 「いまどのキーのせいでこのレイヤーなのか」が一目で分かるように。
    'key-holding': holding,
    'key-unlock': unlockHint,
    'key-trigger': highlight,
    'key-flash': flash,
    'key-shifted': swapShift,
    'key-knob': knob !== undefined,
    'key-clickable': onClick !== undefined
  })
  const mainText = swapShift ? (label.shift ?? '') : label.main
  const shiftText = swapShift ? label.main : label.shift

  // クリックできるとき(モック)だけボタンとして振る舞う。キーボードでもEnter / Spaceで押せる
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

  // 円いキー(ノブ)には下端の色帯が収まらないので出さない。長押しの行き先はツールチップにある
  const showBand = holdLayer !== null && !transparent && !knob
  // 文字を置ける幅。円いキーは四隅が無いぶん狭い
  const room = knob ? width * KNOB_TEXT_ROOM : width
  // 角の丸み。ノブは円にする(ふつうのキーと見分けが付くように)
  const radius = knob ? Math.min(width, height) / 2 : 7
  // ノブの割り当ての文字は、キーの幅に収まればキーの真上・真下に中央揃えで置く
  // (キーどうしの隙間のぶんまでは、はみ出してよい)。収まらなければ図の中央の側へ伸ばす。
  // 外側は隣のキーとぶつかりやすい(Cornixの右手のホイールの割り当ては、外側に伸ばすと隣のH・Nにかかる)
  const knobLabel = (text: string): { x: number; style: React.CSSProperties } => {
    if (!knob || textWidth(text, KNOB_FONT) <= width + GAP * unit) return { x: cx, style: {} }
    return knob.inward === 'left'
      ? { x: x + width, style: { textAnchor: 'end' } }
      : { x, style: { textAnchor: 'start' } }
  }
  const hasSub = Boolean(label.sub) && !showBand
  const hasShift = Boolean(shiftText)

  // 色帯を除いた、文字を置ける範囲の真ん中
  const contentBottom = y + height - (showBand ? BAND_HEIGHT + BAND_INSET : 0)
  const contentCenter = (y + contentBottom) / 2
  // Shift側の文字は、キーキャップの印字と同じように主文字の「上」に置く
  // (左上に小さく出すと見落としやすい)
  const shiftY = y + 13
  const fitted = fitMain(mainText, room)
  // 2行に割ったときは、補足行を2行目の下まで下げる
  const extraLines = (fitted.lines.length - 1) * fitted.fontSize * 1.15
  const mainY = (hasShift ? contentCenter + 6 : contentCenter) - (hasSub ? 5 + extraLines / 2 : 0)
  const subY = mainY + 15 + extraLines / 2

  // 長押し中の表示。レイヤー名が収まらなければ番号に戻す(色でどのレイヤーかは分かる)
  const namedTitle = holdLayerName ? fitMain(holdLayerName, room, 13) : null
  const holdTitle =
    holdLayer === null ? null : namedTitle?.fits ? namedTitle : fitMain(`L${holdLayer}`, room, 13)

  return (
    <g
      className={className}
      transform={rotate}
      style={{ '--hold': holdColor } as React.CSSProperties}
      {...interactive}
    >
      {/* キーの厚み(下の縁)。押すと本体が沈んで隠れる */}
      <rect className="skirt" x={x} y={y + SKIRT} width={width} height={height} rx={radius} />

      {/*
       * 本体。押したときに沈めるのはこの中だけ。外側のgには回転(transform属性)があり、
       * CSSのtransformを掛けると属性ごと上書きされて親指キーの傾きが消えるため
       */}
      <g className="key-body">
        <rect className="cap" x={x} y={y} width={width} height={height} rx={radius} />

        {holding && holdTitle ? (
          <>
            <text className="main" x={cx} y={cy - 9} fontSize={holdTitle.fontSize}>
              <Lines lines={holdTitle.lines} x={cx} fontSize={holdTitle.fontSize} />
            </text>
            <text className="sub" x={cx} y={cy + 8}>
              {holdingSub(label.main, room)}
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
              // .subのfont-sizeはCSSにあるので、属性ではなくstyleで上書きする(属性はCSSに負ける)
              <text
                className="sub"
                x={cx}
                y={subY}
                style={{ fontSize: subFontSize(label.sub, room) }}
              >
                {label.sub}
              </text>
            )}
            {showBand && (
              <>
                <rect
                  className="band"
                  x={x + BAND_INSET}
                  y={y + height - BAND_INSET - BAND_HEIGHT}
                  width={width - BAND_INSET * 2}
                  height={BAND_HEIGHT}
                  // キーの角(7)と同心になるよう、寄せたぶん丸みを小さくする
                  rx={7 - BAND_INSET}
                  fill={layerColor(holdLayer)}
                />
                <text className="band-text" x={cx} y={y + height - BAND_INSET - BAND_HEIGHT / 2}>
                  {bandText(holdLayer, holdLayerName, width - BAND_INSET * 2)}
                </text>
              </>
            )}
          </>
        )}
      </g>

      {knob && (
        // 回したときの割り当て。押しても沈まないよう本体の外に置く
        <>
          {/* 文字の揃え方はCSS(中央揃え)に勝たせるためstyleで渡す */}
          <text className="encoder-label" y={y - KNOB_LABEL_OFFSET} {...knobLabel(knob.cw)}>
            {knob.cw}
          </text>
          <text
            className="encoder-label"
            y={y + height + SKIRT + KNOB_LABEL_OFFSET}
            {...knobLabel(knob.ccw)}
          >
            {knob.ccw}
          </text>
        </>
      )}

      <title>{describe(keycode, label, holdLayer, holdLayerName)}</title>
    </g>
  )
}

function describe(
  keycode: Keycode,
  label: KeyLabel,
  holdLayer: number | null,
  holdLayerName: string | undefined
): string {
  const parts = [label.main || messages.keyCap.none]
  if (holdLayer !== null) parts.push(messages.keyCap.holdTo(holdLayer, holdLayerName))
  if (label.shift) parts.push(messages.keyCap.shift(label.shift))
  if (label.sub) parts.push(label.sub)
  if (label.description) parts.push(label.description)
  parts.push(`raw 0x${keycode.raw.toString(16).padStart(4, '0')}`)
  return parts.join(' / ')
}
