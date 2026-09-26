import { describe, expect, it } from 'vitest'
import { formatShortcut, isModifierCode, shortcutFromKeyboardEvent } from '@/lib/shortcut'

const press = (
  code: string,
  mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {}
) =>
  shortcutFromKeyboardEvent({
    code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false
  })

describe('切り替えのショートカットを組み立てる', () => {
  it('押したキーを、Rustが読める形(Ctrl+Alt+K)にする', () => {
    expect(press('KeyK', { ctrl: true, alt: true })).toBe('Ctrl+Alt+K')
    expect(press('Digit1', { alt: true, shift: true })).toBe('Alt+Shift+1')
    expect(press('F9', { ctrl: true })).toBe('Ctrl+F9')
    expect(press('Space', { meta: true })).toBe('Super+Space')
    expect(press('Numpad5', { ctrl: true })).toBe('Ctrl+Numpad5')
  })

  it('Ctrl・Alt・Winを含まないもの(ふだんの入力とぶつかる)は使えない', () => {
    expect(press('KeyK')).toBeNull()
    expect(press('KeyK', { shift: true })).toBeNull()
  })

  it('Rustが読めないキー(JIS特有のキーなど)は使えない', () => {
    expect(press('IntlRo', { ctrl: true })).toBeNull()
    expect(press('Convert', { alt: true })).toBeNull()
  })

  it('修飾キーだけのあいだは、続けて本体のキーを待つ', () => {
    expect(isModifierCode('ControlLeft')).toBe(true)
    expect(isModifierCode('KeyK')).toBe(false)
  })

  it('画面ではSuperをWinと書く', () => {
    expect(formatShortcut('Ctrl+Super+K')).toBe('Ctrl+Win+K')
    expect(formatShortcut('Ctrl+Alt+K')).toBe('Ctrl+Alt+K')
  })
})
