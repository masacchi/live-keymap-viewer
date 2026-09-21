import { describe, expect, it } from 'vitest'
import { decodeKeycode } from '@/keycodes/decode'
import { type LabelContext, labelForKeycode } from '@/keycodes/labels'
import { MOCK_COLS, MOCK_KEYMAP, MOCK_ROWS, MOCK_TAP_DANCE } from '@/mock/cornix.generated'
import definition from '../reference/cornix-vial-definition.json'

const ctx: LabelContext = {
  customKeycodes: definition.customKeycodes,
  tapDance: MOCK_TAP_DANCE.map((e) => ({ onTap: e[0], onHold: e[1] }))
}

function labelAt(layer: number, row: number, col: number, mode: 'jis' | 'us' = 'jis') {
  const raw = MOCK_KEYMAP[layer * MOCK_ROWS * MOCK_COLS + row * MOCK_COLS + col]
  return labelForKeycode(decodeKeycode(raw), mode, ctx)
}

/**
 * reference/keymap-preview.html の L0 と一致すること(HANDOFF §8 の受け入れ基準)。
 * 値は同ファイルの LAYOUT[0] と JIS / NAMED テーブルから起こした。
 */
const L0_JIS_MAIN: string[][] = [
  ['Tab', 'Q', 'W', 'E', 'R', 'T', ''],
  ['Ctrl', 'A', 'S', 'D', 'F', 'G', ''],
  ['Shift', 'Z', 'X', 'C', 'V', 'B', '消音'],
  ['Ctrl', 'Win', 'Alt', '英数', 'Del', 'BS', ''],
  ['-', 'P', 'O', 'I', 'U', 'Y', ''],
  [':', ';', 'L', 'K', 'J', 'H', '中'],
  [']', '[', '.', ',', 'M', 'N', ''],
  ['`', '\\', '/', 'かな', 'Enter', 'Space', '']
]

describe('JIS ラベル', () => {
  it('ベースレイヤーが reference/keymap-preview.html の L0 と一致する', () => {
    const actual = Array.from({ length: MOCK_ROWS }, (_, row) =>
      Array.from({ length: MOCK_COLS }, (_, col) => labelAt(0, row, col).main)
    )
    expect(actual).toEqual(L0_JIS_MAIN)
  })

  it('Shift 面の文字を併記する', () => {
    expect(labelAt(0, 4, 0)).toMatchObject({ main: '-', shift: '=' }) // KC_MINUS
    expect(labelAt(0, 5, 0)).toMatchObject({ main: ':', shift: '*' }) // KC_QUOTE
    expect(labelAt(0, 6, 0)).toMatchObject({ main: ']', shift: '}' }) // KC_NONUS_HASH
    expect(labelAt(0, 7, 1)).toMatchObject({ main: '\\', shift: '_' }) // KC_RO
  })

  it('LSFT(x) は x の Shift 側の文字そのものを出す', () => {
    // L2 の (0,1) は LSFT(KC_1) → JIS では "!"
    expect(labelAt(2, 0, 1).main).toBe('!')
    // L2 の (1,3) は LSFT(KC_SCOLON) → JIS では "+"
    expect(labelAt(2, 1, 3).main).toBe('+')
    // L2 の (7,1) は LSFT(KC_JYEN) → JIS では "|"
    expect(labelAt(2, 7, 1).main).toBe('|')
  })

  it('JIS 固有のキーを日本語で出す', () => {
    expect(labelAt(0, 7, 3)).toMatchObject({ main: 'かな', sub: 'IME オン' })
    expect(labelAt(0, 3, 3)).toMatchObject({ main: '英数', sub: 'IME オフ' })
    expect(labelAt(2, 2, 2).main).toBe('¥') // KC_JYEN
  })

  it('Layer-Tap はタップ側の文字を出す', () => {
    expect(labelAt(0, 7, 5).main).toBe('Space') // LT2(KC_SPACE)
    expect(labelAt(0, 3, 5).main).toBe('BS') // LT1(KC_BSPACE)
    expect(labelAt(0, 3, 4).main).toBe('Del') // LT3(KC_DELETE)
  })

  it('Tap Dance はタップ側のキーコードで表示する', () => {
    // TD(3) の on_tap は LSFT(KC_LBRACKET) → JIS では "`"
    expect(labelAt(0, 7, 0).main).toBe('`')
  })

  it('USER キーコードを customKeycodes の名前で出す', () => {
    // L4 の (1,0) は USER00 = BT0
    expect(labelAt(4, 1, 0)).toMatchObject({ main: 'BT0', category: 'user' })
    // USER06 の shortName は "Switch\nOutput"
    expect(labelAt(4, 0, 0).main).toBe('Switch Output')
  })

  it('透過キーは ▽ を返す(たどる先を決めるのは LayerEngine の仕事)', () => {
    expect(labelAt(1, 1, 0)).toMatchObject({ main: '▽', category: 'none' })
  })
})

describe('US ラベル', () => {
  it('同じキーコードでも US 配列の文字を出す', () => {
    expect(labelAt(0, 4, 0, 'us')).toMatchObject({ main: '-', shift: '_' }) // KC_MINUS
    expect(labelAt(0, 5, 0, 'us')).toMatchObject({ main: "'", shift: '"' }) // KC_QUOTE
    expect(labelAt(0, 6, 1, 'us')).toMatchObject({ main: ']', shift: '}' }) // KC_RBRACKET
    expect(labelAt(2, 0, 1, 'us').main).toBe('!') // LSFT(KC_1)
    expect(labelAt(2, 1, 5, 'us').main).toBe('@') // LSFT(KC_2) は US だと "@"
  })

  it('かな / 英数 を英語表記にする', () => {
    expect(labelAt(0, 7, 3, 'us')).toMatchObject({ main: 'Lang1' })
    expect(labelAt(0, 3, 3, 'us')).toMatchObject({ main: 'Lang2' })
  })

  it('アルファベットと名前付きキーは JIS と同じ', () => {
    expect(labelAt(0, 0, 1, 'us').main).toBe('Q')
    expect(labelAt(0, 0, 0, 'us').main).toBe('Tab')
  })
})
