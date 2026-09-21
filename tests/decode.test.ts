import { describe, expect, it } from 'vitest'
import {
  decodeKeycode,
  formatKeycode,
  MOD_ALT,
  MOD_CTRL,
  MOD_GUI,
  MOD_SHIFT
} from '@/keycodes/decode'

/** 生の値 → Vial の文字列表記。値は keycodes_v6.py の定数から。 */
const ROUND_TRIP: Array<[number, string]> = [
  [0x0000, 'KC_NO'],
  [0x0001, 'KC_TRNS'],
  [0x0004, 'KC_A'],
  [0x002b, 'KC_TAB'],
  [0x0087, 'KC_RO'],
  [0x0089, 'KC_JYEN'],
  [0x0090, 'KC_LANG1'],
  [0x0091, 'KC_LANG2'],
  [0x0204, 'LSFT(KC_A)'], // LSFT = 0x0200, KC_A = 0x04
  [0x021e, 'LSFT(KC_1)'],
  [0x1404, 'RALT(KC_A)'], // 右 Alt は 0x1400
  [0x2204, 'LSFT_T(KC_A)'], // Mod-Tap
  [0x4229, 'LT2(KC_ESCAPE)'],
  [0x5200, 'TO(0)'],
  [0x5222, 'MO(2)'],
  [0x5241, 'DF(1)'],
  [0x5263, 'TG(3)'],
  [0x5284, 'OSL(4)'],
  [0x52c5, 'TT(5)'],
  [0x52e6, 'PDF(6)'],
  [0x5703, 'TD(3)'],
  [0x7701, 'M1'],
  [0x7e00, 'USER00'],
  [0x7e06, 'USER06']
]

describe('decodeKeycode', () => {
  it.each(ROUND_TRIP)('$0 を $1 に戻す', (raw, expected) => {
    expect(formatKeycode(decodeKeycode(raw))).toBe(expected)
  })

  it('KC_NO と KC_TRNS を区別する', () => {
    expect(decodeKeycode(0x0000).kind).toBe('none')
    expect(decodeKeycode(0x0001).kind).toBe('trns')
  })

  it('モディファイア付きキーからモディファイアと内側キーを取り出す', () => {
    const kc = decodeKeycode(0x021e)
    expect(kc).toMatchObject({ kind: 'mods', mods: MOD_SHIFT })
    if (kc.kind !== 'mods') throw new Error('unreachable')
    expect(kc.inner).toMatchObject({ kind: 'basic', name: 'KC_1' })
  })

  it('複数のモディファイアをビットとして持つ', () => {
    // LCAG = Ctrl + Alt + Gui = 0x0d00
    const kc = decodeKeycode(0x0d04)
    if (kc.kind !== 'mods') throw new Error('unreachable')
    expect(kc.mods & MOD_CTRL).toBeTruthy()
    expect(kc.mods & MOD_ALT).toBeTruthy()
    expect(kc.mods & MOD_GUI).toBeTruthy()
    expect(kc.mods & MOD_SHIFT).toBeFalsy()
  })

  it('Layer-Tap からレイヤー番号とタップ側キーを取り出す', () => {
    const kc = decodeKeycode(0x4000 | (3 << 8) | 0x4c) // LT3(KC_DELETE)
    expect(kc).toMatchObject({ kind: 'layerTap', layer: 3 })
    if (kc.kind !== 'layerTap') throw new Error('unreachable')
    expect(kc.inner).toMatchObject({ name: 'KC_DELETE' })
  })

  it('LM(layer, mod) を 0x5000 帯として解釈する', () => {
    // LM(2, MOD_LSFT) = 0x5000 | (2 << 5) | 0x02
    const kc = decodeKeycode(0x5000 | (2 << 5) | MOD_SHIFT)
    expect(kc).toMatchObject({ kind: 'layerMod', layer: 2, mods: MOD_SHIFT })
  })

  it('OSM をレイヤー系と取り違えない', () => {
    // 0x52A0-0x52BF は OSM。TT(0) = 0x52C0 の手前
    expect(decodeKeycode(0x52a2)).toMatchObject({ kind: 'oneShotMod', mods: MOD_SHIFT })
    expect(decodeKeycode(0x52c0)).toMatchObject({ kind: 'layer', op: 'TT', layer: 0 })
  })

  it('USER の範囲は 64 個まで', () => {
    expect(decodeKeycode(0x7e3f)).toMatchObject({ kind: 'user', index: 63 })
    // 0x7E40 以降は USER ではない
    expect(decodeKeycode(0x7e40).kind).not.toBe('user')
  })

  it('知らない値は unknown として生の値を保つ', () => {
    const kc = decodeKeycode(0x6fff)
    expect(kc).toMatchObject({ kind: 'unknown', raw: 0x6fff })
    expect(formatKeycode(kc)).toBe('0x6fff')
  })
})
