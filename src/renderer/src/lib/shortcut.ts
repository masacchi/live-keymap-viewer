/**
 * 切り替えのショートカット(設定のtoggleShortcut)を、押したキーから組み立てる・表示する。
 *
 * 形はRust(tauri-plugin-global-shortcutが使うglobal-hotkey)が読める`Ctrl+Alt+K`。キーの名前は
 * `KeyboardEvent.code`から取るので、JIS / USの配列の設定によらず同じ位置のキーになる。
 * 検証の本体はRust(settings.rsのsanitize_shortcut)で、ここは押したものを送れる形にするだけ。
 */

/** `KeyboardEvent.code`のうち、そのままの名前でRustが読めるもの(global-hotkeyのparse_key)。 */
const NAMED_CODES = new Set([
  'Backquote',
  'Backslash',
  'BracketLeft',
  'BracketRight',
  'Comma',
  'Equal',
  'Minus',
  'Period',
  'Quote',
  'Semicolon',
  'Slash',
  'Backspace',
  'Enter',
  'Space',
  'Tab',
  'Delete',
  'End',
  'Home',
  'Insert',
  'PageDown',
  'PageUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'NumpadAdd',
  'NumpadDecimal',
  'NumpadDivide',
  'NumpadEnter',
  'NumpadMultiply',
  'NumpadSubtract'
])

/** 修飾キーそのもの。これだけが押されたときは、続けて本体のキーを待つ。 */
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight'
])

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code)
}

/** 本体のキーの名前。使えないキー(JIS特有のキーなど、Rustが読めないもの)ならnull。 */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code)
  if (digit) return code.startsWith('Numpad') ? `Numpad${digit[1]}` : digit[1]
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return NAMED_CODES.has(code) ? code : null
}

/**
 * 押したキーからショートカットを組み立てる。使えなければnull。
 *
 * Ctrl・Alt・Winのどれかを含むものだけ(Rustのsanitize_shortcutと同じ)。Shiftと文字だけや、
 * キー1つだけを登録すると、ふだんの入力をアプリが奪ってしまう。
 */
export function shortcutFromKeyboardEvent(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
): string | null {
  const key = keyName(event.code)
  if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) return null
  const modifiers = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Super'
  ].filter((modifier): modifier is string => modifier !== false)
  return [...modifiers, key].join('+')
}

/** 画面に出す形。Rustの`Super`はWindowsのキーなので`Win`と書く。 */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => (/^(super|cmd|command)$/i.test(part) ? 'Win' : part))
    .join('+')
}
