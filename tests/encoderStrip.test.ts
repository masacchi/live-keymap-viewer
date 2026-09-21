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
  it('全角は 1em、半角は 0.58em で見積もる', () => {
    expect(estimateTextWidth('音量', 10)).toBe(20)
    expect(estimateTextWidth('ab', 10)).toBeCloseTo(11.6)
  })
})

describe('layoutEncoderStrip', () => {
  it('ノブが無ければ null', () => {
    expect(
      layoutEncoderStrip({ items: [], keyBounds, placement: 'bottom', unit: UNIT, fontSize: 13 })
    ).toBeNull()
  })

  it('キー範囲の中央に揃える', () => {
    const strip = layoutEncoderStrip({
      items,
      keyBounds,
      placement: 'bottom',
      unit: UNIT,
      fontSize: 13
    })!
    const center = ((keyBounds.minX + keyBounds.maxX) / 2) * UNIT
    expect((strip.minX + strip.maxX) / 2).toBeCloseTo(center)
  })

  it('左から順に並び、重ならない', () => {
    const strip = layoutEncoderStrip({
      items,
      keyBounds,
      placement: 'bottom',
      unit: UNIT,
      fontSize: 13
    })!
    const [a, b] = strip.items
    expect(a.dotX).toBeLessThan(a.ccwX)
    expect(a.ccwX).toBeLessThan(a.cwX)
    expect(a.cwX + estimateTextWidth(a.cw, 13)).toBeLessThan(b.dotX - strip.dotRadius)
  })

  it('下に置けばキーの下端より下、上に置けば上端より上', () => {
    const bottom = layoutEncoderStrip({
      items,
      keyBounds,
      placement: 'bottom',
      unit: UNIT,
      fontSize: 13
    })!
    const top = layoutEncoderStrip({
      items,
      keyBounds,
      placement: 'top',
      unit: UNIT,
      fontSize: 13
    })!
    expect(bottom.y).toBeGreaterThan(keyBounds.maxY * UNIT)
    expect(top.y).toBeLessThan(keyBounds.minY * UNIT)
  })
})

describe('viewBoxFor', () => {
  function parse(viewBox: string): number[] {
    return viewBox.split(' ').map(Number)
  }

  it('ノブが無ければキー範囲+余白', () => {
    const [x, y, w, h] = parse(viewBoxFor(keyBounds, null, 'bottom', UNIT, 0.2))
    expect([x, y]).toEqual([-10, -10])
    expect(w).toBeCloseTo(10.4 * UNIT)
    expect(h).toBeCloseTo(4.4 * UNIT)
  })

  it('ノブの帯のぶんだけ、置いた側に伸ばす', () => {
    const strip = layoutEncoderStrip({
      items,
      keyBounds,
      placement: 'bottom',
      unit: UNIT,
      fontSize: 13
    })
    const [, y, , h] = parse(viewBoxFor(keyBounds, strip, 'bottom', UNIT, 0.2))
    expect(y).toBe(-10) // 上は伸びない
    expect(h).toBeCloseTo((4 + ENCODER_STRIP_HEIGHT + 0.4) * UNIT)
  })

  it('帯がキーより広ければ横も広げる', () => {
    const narrow = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const strip = layoutEncoderStrip({
      items,
      keyBounds: narrow,
      placement: 'bottom',
      unit: UNIT,
      fontSize: 13
    })!
    const [x, , w] = parse(viewBoxFor(narrow, strip, 'bottom', UNIT, 0))
    expect(x).toBeCloseTo(strip.minX)
    expect(w).toBeCloseTo(strip.maxX - strip.minX)
  })
})
