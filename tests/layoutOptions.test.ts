import { describe, expect, it } from 'vitest'
import { decodeLayoutOptions, encodeLayoutOptions, optionBits } from '@/layout/layoutOptions'
import definition from '../reference/cornix-vial-definition.json'

describe('optionBits', () => {
  it('ON/OFF は 1 ビット', () => {
    expect(optionBits('Split Backspace')).toBe(1)
  })

  it('選択肢が 2 個なら 1 ビット、3〜4 個なら 2 ビット', () => {
    expect(optionBits(['Bottom row', 'a', 'b'])).toBe(1)
    expect(optionBits(['Bottom row', 'a', 'b', 'c'])).toBe(2)
    expect(optionBits(['Bottom row', 'a', 'b', 'c', 'd'])).toBe(2)
    expect(optionBits(['Bottom row', 'a', 'b', 'c', 'd', 'e'])).toBe(3)
  })

  it('選択肢が 1 個でも 1 ビットは使う(vial-gui の pack と同じ)', () => {
    expect(optionBits(['Firmware Version', 'V1.12'])).toBe(1)
  })
})

describe('decodeLayoutOptions', () => {
  const labels = [['A', 'a0', 'a1', 'a2'], 'B', ['C', 'c0', 'c1']] // 2 + 1 + 1ビット

  it('後ろの選択肢ほど下位ビットに入る', () => {
    // A=2 (0b10), B=1, C=0 → 0b10 1 0 = 0b1010 = 10
    expect(decodeLayoutOptions(0b1010, labels)).toEqual([2, 1, 0])
    // A=0, B=0, C=1 → 0b00 0 1 = 1
    expect(decodeLayoutOptions(0b0001, labels)).toEqual([0, 0, 1])
  })

  it('encode と往復する', () => {
    for (const choices of [
      [0, 0, 0],
      [1, 1, 1],
      [3, 0, 1],
      [2, 1, 0]
    ]) {
      expect(decodeLayoutOptions(encodeLayoutOptions(choices, labels), labels)).toEqual(choices)
    }
  })

  it('labels が無ければ空', () => {
    expect(decodeLayoutOptions(0xff, undefined)).toEqual([])
    expect(decodeLayoutOptions(0xff, [])).toEqual([])
  })

  it('Cornix の定義では選択肢が 1 つだけ', () => {
    expect(decodeLayoutOptions(0, definition.layouts.labels)).toEqual([0])
  })
})
