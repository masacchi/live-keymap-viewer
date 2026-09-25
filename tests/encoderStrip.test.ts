import { describe, expect, it } from 'vitest'
import {
  ENCODER_STRIP_HEIGHT,
  estimateTextWidth,
  layoutEncoderStrip,
  viewBoxFor
} from '@/layout/encoderStrip'

const keyBounds = { minX: 0, minY: 0, maxX: 10, maxY: 4 }
const UNIT = 50
const items = [
  { index: 0, ccw: '↺ 音量−', cw: '↻ 音量+' },
  { index: 1, ccw: '↺ ↑', cw: '↻ ↓' }
]

describe('estimateTextWidth', () => {
  it('全角は1em、半角は0.58emで見積もる', () => {
    expect(estimateTextWidth('音量', 10)).toBe(20)
    expect(estimateTextWidth('ab', 10)).toBeCloseTo(11.6)
  })
})

describe('layoutEncoderStrip', () => {
  const layout = (bounds = keyBounds) =>
    layoutEncoderStrip({ items, keyBounds: bounds, unit: UNIT, fontSize: 13 })

  it('ノブが無ければnull', () => {
    expect(layoutEncoderStrip({ items: [], keyBounds, unit: UNIT, fontSize: 13 })).toBeNull()
  })

  it('キー範囲の中央に揃える', () => {
    const strip = layout()!
    const center = ((keyBounds.minX + keyBounds.maxX) / 2) * UNIT
    expect((strip.minX + strip.maxX) / 2).toBeCloseTo(center)
  })

  it('右回りを丸の上、左回りを丸の下に挟む(音量なら「音量+」が上)', () => {
    const strip = layout()!
    expect(strip.cwY).toBeLessThan(strip.y - strip.dotRadius)
    expect(strip.ccwY).toBeGreaterThan(strip.y + strip.dotRadius)
  })

  it('左から順に並び、文字どうしも重ならない', () => {
    const strip = layout()!
    const [a, b] = strip.items
    expect(a.x).toBeLessThan(b.x)
    // 文字は中央揃え。aの右端よりbの左端が右にある
    const half = (text: string) => estimateTextWidth(text, 13) / 2
    expect(a.x + Math.max(half(a.ccw), half(a.cw))).toBeLessThan(
      b.x - Math.max(half(b.ccw), half(b.cw))
    )
  })

  it('キーの下端より下の、帯の中に収まる', () => {
    const strip = layout()!
    const top = keyBounds.maxY * UNIT
    const bottom = (keyBounds.maxY + ENCODER_STRIP_HEIGHT) * UNIT
    // 上の文字の上端がキーの下端より下、下の文字の下端が帯の下端より上
    expect(strip.cwY - 13 / 2).toBeGreaterThan(top)
    expect(strip.ccwY + 13 / 2).toBeLessThan(bottom)
  })
})

describe('viewBoxFor', () => {
  function parse(viewBox: string): number[] {
    return viewBox.split(' ').map(Number)
  }

  it('ノブが無ければキー範囲+余白', () => {
    const [x, y, w, h] = parse(viewBoxFor(keyBounds, null, UNIT, 0.2))
    expect([x, y]).toEqual([-10, -10])
    expect(w).toBeCloseTo(10.4 * UNIT)
    expect(h).toBeCloseTo(4.4 * UNIT)
  })

  it('ノブの帯のぶんだけ下に伸ばす', () => {
    const strip = layoutEncoderStrip({ items, keyBounds, unit: UNIT, fontSize: 13 })
    const [, y, , h] = parse(viewBoxFor(keyBounds, strip, UNIT, 0.2))
    expect(y).toBe(-10) // 上は伸びない
    expect(h).toBeCloseTo((4 + ENCODER_STRIP_HEIGHT + 0.4) * UNIT)
  })

  it('帯がキーより広ければ横も広げる', () => {
    const narrow = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const strip = layoutEncoderStrip({ items, keyBounds: narrow, unit: UNIT, fontSize: 13 })!
    const [x, , w] = parse(viewBoxFor(narrow, strip, UNIT, 0))
    expect(x).toBeCloseTo(strip.minX)
    expect(w).toBeCloseTo(strip.maxX - strip.minX)
  })
})
