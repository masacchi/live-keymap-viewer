import { describe, expect, it } from 'vitest'
import { knobButtonsFor } from '@/layout/knobButtons'

describe('knobButtonsFor', () => {
  const cornix = { vendorId: '0xE118', productId: '0x0001', matrix: { rows: 8, cols: 7 } }

  it('Cornix LP は、左手のノブが 2,6、右手が 5,6', () => {
    expect(knobButtonsFor(cornix)).toEqual([
      { index: 0, row: 2, col: 6 },
      { index: 1, row: 5, col: 6 }
    ])
  })

  it('VID / PID は文字列(16 進)でも数でも受け付ける', () => {
    expect(knobButtonsFor({ ...cornix, vendorId: 0xe118, productId: 1 })).toHaveLength(2)
  })

  it('知らないキーボードや、行列の大きさが違うものには当てはめない', () => {
    expect(knobButtonsFor({ ...cornix, vendorId: '0x1234' })).toEqual([])
    expect(knobButtonsFor({ ...cornix, matrix: { rows: 5, cols: 14 } })).toEqual([])
    expect(knobButtonsFor({ matrix: { rows: 8, cols: 7 } })).toEqual([])
  })
})
