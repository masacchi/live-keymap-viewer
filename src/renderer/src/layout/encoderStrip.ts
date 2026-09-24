/**
 * 押し込みキーが分からないノブ(エンコーダー)の割り当てを、キーの下に横一列で並べる配置計算。
 * 押し込みキーが分かるノブ(layout/knobButtons.ts。Cornix LP)は、そのキーに付けて描くので
 * ここには来ない。
 *
 * 1つずつ、右回り(↻)の割り当てを丸の上、左回り(↺)を丸の下に挟んで置く(音量なら「音量+」が上)。
 * 押し込みキーに付けるときと同じ形にそろえるため。
 *
 * ノブはKLE上の座標では描かない。Cornix LPの定義はエンコーダーを図の右端
 * (x=15.25〜)にまとめて置いてあり、そのまま描くと横幅が1.3倍ほどに間延びする。
 * 位置に意味は無い(回転はmatrixに出ないので押下表示もできない、docs/PROTOCOL.md §6)
 * ので、割り当ての一覧としてまとめて出す。
 *
 * 描画(SVG)から切り離してあるのは、単体テストで位置を確認するため。
 */
import type { Bounds } from './geometry'

/** 帯の高さ(1u単位)。上の文字・丸・下の文字が収まり、キーの下の縁とくっつかない高さ。 */
export const ENCODER_STRIP_HEIGHT = 1.4

export interface EncoderStripInput {
  /** 並べる順(エンコーダー番号の昇順を想定)。 */
  items: ReadonlyArray<{ index: number; ccw: string; cw: string }>
  keyBounds: Bounds
  /** 1uのpx。 */
  unit: number
  /** 文字の大きさ(px)。幅と上下の位置の見積もりに使う。 */
  fontSize: number
}

export interface PlacedEncoder {
  index: number
  ccw: string
  cw: string
  /** 丸と、上下の文字の中心(文字は中央揃えで置く)。 */
  x: number
}

export interface EncoderStrip {
  items: PlacedEncoder[]
  /** 丸の中心の高さ(px)。 */
  y: number
  /** 右回り(上)と左回り(下)の文字の縦中心(px)。 */
  cwY: number
  ccwY: number
  dotRadius: number
  /** 帯の左右端(px)。viewBoxを広げるのに使う。 */
  minX: number
  maxX: number
}

/**
 * SVGには文字幅を測る手立てが無いので見積もる。
 * 全角はほぼ1em、それ以外は0.58emとして扱えば、中央揃えには十分。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text) {
    width += /[　-ヿ㐀-鿿＀-￯]/.test(ch) ? fontSize : fontSize * 0.58
  }
  return width
}

/** 並べる。ノブが無ければnull。 */
export function layoutEncoderStrip(input: EncoderStripInput): EncoderStrip | null {
  const { items, keyBounds, unit, fontSize } = input
  if (items.length === 0) return null

  const dotRadius = 0.22 * unit
  /** 丸の縁と文字のあいだ。 */
  const labelGap = 0.14 * unit
  const itemGap = 0.4 * unit

  // 1つぶんの幅は、上下の文字と丸のうち広いもの
  const sized = items.map((item) => ({
    ...item,
    width: Math.max(
      estimateTextWidth(item.ccw, fontSize),
      estimateTextWidth(item.cw, fontSize),
      dotRadius * 2
    )
  }))

  const total = sized.reduce((sum, item) => sum + item.width, 0) + itemGap * (sized.length - 1)
  const centerX = ((keyBounds.minX + keyBounds.maxX) / 2) * unit
  const y = (keyBounds.maxY + ENCODER_STRIP_HEIGHT / 2) * unit
  const labelOffset = dotRadius + labelGap + fontSize / 2

  let cursor = centerX - total / 2
  const placed = sized.map((item): PlacedEncoder => {
    const x = cursor + item.width / 2
    cursor += item.width + itemGap
    return { index: item.index, ccw: item.ccw, cw: item.cw, x }
  })

  return {
    items: placed,
    y,
    cwY: y - labelOffset,
    ccwY: y + labelOffset,
    dotRadius,
    minX: centerX - total / 2,
    maxX: centerX + total / 2
  }
}

/**
 * キーとノブの帯をまとめて収めるviewBox(px)。帯はいつもキーの下。
 * `pad`は周りの余白(1u単位)。
 */
export function viewBoxFor(
  keyBounds: Bounds,
  strip: EncoderStrip | null,
  unit: number,
  pad = 0.2
): string {
  const minX = Math.min(keyBounds.minX, strip ? strip.minX / unit : Infinity)
  const maxX = Math.max(keyBounds.maxX, strip ? strip.maxX / unit : -Infinity)
  const minY = keyBounds.minY
  const maxY = keyBounds.maxY + (strip ? ENCODER_STRIP_HEIGHT : 0)
  return [
    (minX - pad) * unit,
    (minY - pad) * unit,
    (maxX - minX + pad * 2) * unit,
    (maxY - minY + pad * 2) * unit
  ].join(' ')
}
