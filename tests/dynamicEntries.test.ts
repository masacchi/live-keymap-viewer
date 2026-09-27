import { describe, expect, it } from 'vitest'
import { MockTransport } from '@/hid/mockTransport'
import { getMacros, loadKeyboard } from '@/hid/vial'
import { decodeKeycode } from '@/keycodes/decode'
import { decodeMacro, decodeMacroBuffer, formatCombo, formatMacro } from '@/keycodes/dynamicEntries'
import { labelForKeycode } from '@/keycodes/labels'

/** 「hi」→ Enter → 100ms待つ → Ctrl+C(2バイトのキーコード)。 */
const HELLO = [0x68, 0x69, 0x01, 0x01, 0x28, 0x01, 0x04, 101, 1, 0x01, 0x05, 0x06, 0x01]
/** Ctrlを押す → Cをタップ → Ctrlを離す。 */
const COPY = [0x01, 0x02, 0xe0, 0x01, 0x01, 0x06, 0x01, 0x03, 0xe0]
const buffer = () => new Uint8Array([...HELLO, 0, ...COPY, 0])
const name = (raw: number) => labelForKeycode(decodeKeycode(raw), 'us').main || raw.toString(16)

describe('マクロをほどく(Vialの形式。vial-guiのmacro_deserialize_v2)', () => {
  it('文字・タップ・待つ・2バイトのキーコードを読む', () => {
    expect(decodeMacro(new Uint8Array(HELLO))).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'tap', keycodes: [0x28] },
      { kind: 'delay', ms: 100 },
      { kind: 'tap', keycodes: [0x0106] }
    ])
  })

  it('押す・離すを読み、NULで区切ったマクロを数だけ取り出す(足りない分は空)', () => {
    const macros = decodeMacroBuffer(buffer(), 3)
    expect(macros[1]).toEqual([
      { kind: 'down', keycodes: [0xe0] },
      { kind: 'tap', keycodes: [0x06] },
      { kind: 'up', keycodes: [0xe0] }
    ])
    expect(macros[2]).toEqual([])
  })

  it('1行の文にする', () => {
    const [hello, copy] = decodeMacroBuffer(buffer(), 2)
    expect(formatMacro(hello, name)).toBe(`"hi" ${name(0x28)} 100ms ${name(0x0106)}`)
    expect(formatMacro(copy, name)).toBe(`↓${name(0xe0)} ${name(0x06)} ↑${name(0xe0)}`)
    expect(formatCombo({ index: 0, keys: [0x16, 0x07], output: 0x29 }, name)).toBe(
      `${name(0x16)} + ${name(0x07)} → ${name(0x29)}`
    )
  })
})

describe('マクロとコンボを読む', () => {
  const macros = () => ({ count: 16, buffer: buffer(), bufferSize: 1024 })

  it('マクロは、数だけのNULが揃ったところで読むのをやめる(領域をぜんぶは読まない)', async () => {
    const transport = new MockTransport({ unlocked: true, macros: macros() })
    await transport.open()
    const read = await getMacros(transport)
    expect(read[0][0]).toEqual({ kind: 'text', text: 'hi' })
    // 中身は24バイト。16個ぶんのNULは2回目(56バイトまで)でそろい、1024バイト(37回ぶん)は読まない
    expect(transport.requests.filter((r) => r[0] === 0x0e)).toHaveLength(2)
  })

  it('キーマップにM(n)が無ければマクロは読まず、あれば読む', async () => {
    const plain = new MockTransport({ unlocked: true, macros: macros() })
    await plain.open()
    expect((await loadKeyboard(plain)).macros).toEqual([])
    expect(plain.requests.some((r) => r[0] === 0x0c)).toBe(false)

    const withMacro = new MockTransport({ unlocked: true, macros: macros() })
    withMacro.setKeycode(0, 0, 1, 0x7700) // QをM0にする
    await withMacro.open()
    const snapshot = await loadKeyboard(withMacro)
    expect(snapshot.macros[0][0]).toEqual({ kind: 'text', text: 'hi' })
    // M0のキーの説明に中身が出る
    const label = labelForKeycode(decodeKeycode(0x7700), 'us', { macros: snapshot.macros })
    expect(label.description).toBe(`マクロ: "hi" ${name(0x28)} 100ms ${name(0x0106)}`)
  })

  it('コンボは使っている枠だけを取り出し、押すキーの説明に出す', async () => {
    const transport = new MockTransport({
      unlocked: true,
      combos: [
        [0x16, 0x07, 0, 0, 0x29], // S + D → Esc
        [0, 0, 0, 0, 0] // 使っていない
      ]
    })
    await transport.open()
    const snapshot = await loadKeyboard(transport)
    expect(snapshot.combos).toEqual([{ index: 0, keys: [0x16, 0x07], output: 0x29 }])
    const label = labelForKeycode(decodeKeycode(0x16), 'us', { combos: snapshot.combos })
    expect(label.description).toBe(`コンボ: ${name(0x16)} + ${name(0x07)} → ${name(0x29)}`)
  })
})
