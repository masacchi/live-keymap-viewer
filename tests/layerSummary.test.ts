import { beforeAll, describe, expect, it } from 'vitest'
import { summarizeLayers } from '@/engine/layerSummary'
import { MockTransport } from '@/hid/mockTransport'
import { type KeyboardSnapshot, loadKeyboard } from '@/hid/vial'
import { KC_NO, KC_TRNS, QK_LAYER_TAP, QK_MOMENTARY, QK_TOGGLE_LAYER } from '@/keycodes/decode'

let snapshot: KeyboardSnapshot

beforeAll(async () => {
  const transport = new MockTransport({ unlocked: true })
  await transport.open()
  snapshot = await loadKeyboard(transport)
})

describe('summarizeLayers: Cornix', () => {
  it('L1〜L4に、ベースレイヤーのどのキーで入るかを拾う', () => {
    const summary = summarizeLayers(snapshot)
    const first = (layer: number) => summary[layer].triggers[0]
    // BS = LT1、Space = LT2、Del = LT3、` = TD(3)(長押しでMO(4))
    expect(first(1)).toMatchObject({ fromLayer: 0, row: 3, col: 5, kind: 'hold' })
    expect(first(2)).toMatchObject({ fromLayer: 0, row: 7, col: 5, kind: 'hold' })
    expect(first(3)).toMatchObject({ fromLayer: 0, row: 3, col: 4, kind: 'hold' })
    expect(first(4)).toMatchObject({ fromLayer: 0, row: 7, col: 0, kind: 'hold' })
  })

  it('L5〜L9は空(ノブの押し込みがL0と同じで、ほかはKC_NO)。行き方も無い', () => {
    const summary = summarizeLayers(snapshot)
    expect(summary.map((s) => s.blank)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true
    ])
    for (const layer of [5, 6, 7, 8, 9]) expect(summary[layer].triggers).toEqual([])
  })
})

describe('summarizeLayers: 作ったキーマップ', () => {
  // 3レイヤー × 1行 × 3列
  const keymap = (l0: number[], l1: number[], l2: number[] = [KC_TRNS, KC_TRNS, KC_TRNS]) => [
    [l0],
    [l1],
    [l2]
  ]

  it('TG / MOはその入り方で拾い、自分自身へのキーは行き方にしない', () => {
    const summary = summarizeLayers({
      keymap: keymap(
        [QK_TOGGLE_LAYER | 2, QK_MOMENTARY | 1, 0x04],
        [QK_MOMENTARY | 1, KC_TRNS, KC_TRNS]
      ),
      tapDance: []
    })
    expect(summary[1].triggers).toEqual([
      expect.objectContaining({ fromLayer: 0, col: 1, kind: 'momentary' })
    ])
    expect(summary[2].triggers).toEqual([
      expect.objectContaining({ fromLayer: 0, col: 0, kind: 'toggle' })
    ])
  })

  it('上のレイヤーにある行き方は、ベースレイヤーのものの後ろに並ぶ', () => {
    const summary = summarizeLayers({
      keymap: keymap(
        [0x04, QK_LAYER_TAP | (2 << 8) | 0x2c, 0x05],
        [QK_TOGGLE_LAYER | 2, KC_TRNS, KC_TRNS]
      ),
      tapDance: []
    })
    expect(summary[2].triggers.map((t) => [t.fromLayer, t.kind])).toEqual([
      [0, 'hold'],
      [1, 'toggle']
    ])
  })

  it('ベースレイヤーと違うキーが1つでもあれば空ではない。ノブの割り当ても見る', () => {
    const base = [0x04, 0x05, 0x06]
    expect(
      summarizeLayers({ keymap: keymap(base, [KC_NO, 0x05, KC_TRNS]), tapDance: [] })[1].blank
    ).toBe(true)
    expect(
      summarizeLayers({ keymap: keymap(base, [0x07, KC_TRNS, KC_TRNS]), tapDance: [] })[1].blank
    ).toBe(false)

    const encoders = [[[0x80, 0x81]], [[0x80, 0x81]], [[0x80, 0x82]]]
    const summary = summarizeLayers({
      keymap: keymap(base, [KC_NO, KC_NO, KC_NO]),
      tapDance: [],
      encoders
    })
    expect(summary[1].blank).toBe(true) // ノブもL0と同じ
    expect(summary[2].blank).toBe(false) // ノブだけ違う
  })

  it('ベースレイヤーは空とは言わない', () => {
    expect(
      summarizeLayers({
        keymap: keymap([KC_NO, KC_NO, KC_NO], [KC_NO, KC_NO, KC_NO]),
        tapDance: []
      })[0].blank
    ).toBe(false)
  })
})
