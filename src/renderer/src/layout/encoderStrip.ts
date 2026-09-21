/**
 * ノブ(エンコーダー)の割り当てを、キーの上か下に横一列で並べる配置計算。
 *
 * ノブは KLE 上の座標では描かない。Cornix LP の定義はエンコーダーを図の右端
 * (x=15.25〜)にまとめて置いてあり、そのまま描くと横幅が 1.3 倍ほどに間延びする。
 * 位置に意味は無い(回転は matrix に出ないので押下表示もできない、docs/PROTOCOL.md §5.5)
 * ので、割り当ての一覧としてまとめて出す。
 *
 * 描画(SVG)から切り離してあるのは、単体テストで位置を確かめるため。
 */
import type { Bounds } from './geometry'

export type EncoderPlacement = 'top' | 'bottom'

/** 帯の高さ(1u 単位)。 */
export const ENCODER_STRIP_HEIGHT = 0.8

export interface EncoderStripInput {
  /** 並べる順(エンコーダー番号の昇順を想定)。 */
  items: ReadonlyArray<{ index: number; ccw: string; cw: string }>
  keyBounds: Bounds
  placement: EncoderPlacement
  /** 1u の px。 */
  unit: number
  /** 文字の大きさ(px)。幅の見積もりに使う。 */
  fontSize: number
}

export interface PlacedEncoder {
  index: number
  ccw: string
  cw: string
  /** 丸の中心。 */
  dotX: number
  /** 反時計回りの文字の左端。 */
  ccwX: number
  /** 時計回りの文字の左端。 */
  cwX: number
}

export interface EncoderStrip {
  items: PlacedEncoder[]
  /** 帯の縦中心(px)。 */
  y: number
  dotRadius: number
  /** 帯の左右端(px)。viewBox を広げるのに使う。 */
  minX: number
  maxX: number
}

/**
 * SVG には文字幅を測る手立てが無いので見積もる。
 * 全角はほぼ 1em、それ以外は 0.58em として扱えば、中央揃えには十分。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text) {
    width += /[　-ヿ㐀-鿿＀-￯]/.test(ch) ? fontSize : fontSize * 0.58
  }
  return width
}

/** 並べる。ノブが無ければ null。 */
export function layoutEncoderStrip(input: EncoderStripInput): EncoderStrip | null {
  const { items, keyBounds, placement, unit, fontSize } = input
  if (items.length === 0) return null

  const dotRadius = 0.16 * unit
  const innerGap = 0.16 * unit
  const itemGap = 0.5 * unit

  const sized = items.map((item) => {
    const ccwWidth = estimateTextWidth(item.ccw, fontSize)
    const cwWidth = estimateTextWidth(item.cw, fontSize)
    return {
      ...item,
      ccwWidth,
      width: dotRadius * 2 + innerGap + ccwWidth + innerGap * 2 + cwWidth
    }
  })

  const total = sized.reduce((sum, item) => sum + item.width, 0) + itemGap * (sized.length - 1)
  const centerX = ((keyBounds.minX + keyBounds.maxX) / 2) * unit
  const y =
    (placement === 'top'
      ? keyBounds.minY - ENCODER_STRIP_HEIGHT / 2
      : keyBounds.maxY + ENCODER_STRIP_HEIGHT / 2) * unit

  let cursor = centerX - total / 2
  const placed = sized.map((item): PlacedEncoder => {
    const x = cursor
    cursor += item.width + itemGap
    return {
      index: item.index,
      ccw: item.ccw,
      cw: item.cw,
      dotX: x + dotRadius,
      ccwX: x + dotRadius * 2 + innerGap,
      cwX: x + dotRadius * 2 + innerGap + item.ccwWidth + innerGap * 2
    }
  })

  return {
    items: placed,
    y,
    dotRadius,
    minX: centerX - total / 2,
    maxX: centerX + total / 2
  }
}

/**
 * キーとノブの帯をまとめて収める viewBox(px)。
 * `pad` は周りの余白(1u 単位)。
 */
export function viewBoxFor(
  keyBounds: Bounds,
  strip: EncoderStrip | null,
  placement: EncoderPlacement,
  unit: number,
  pad = 0.2
): string {
  const minX = Math.min(keyBounds.minX, strip ? strip.minX / unit : Infinity)
  const maxX = Math.max(keyBounds.maxX, strip ? strip.maxX / unit : -Infinity)
  const minY = keyBounds.minY - (strip && placement === 'top' ? ENCODER_STRIP_HEIGHT : 0)
  const maxY = keyBounds.maxY + (strip && placement === 'bottom' ? ENCODER_STRIP_HEIGHT : 0)
  return [
    (minX - pad) * unit,
    (minY - pad) * unit,
    (maxX - minX + pad * 2) * unit,
    (maxY - minY + pad * 2) * unit
  ].join(' ')
}
