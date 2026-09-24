/**
 * キーコード → 画面に出す文字。
 *
 * JISモードは「Windowsを日本語キーボード設定にしたまま使ったときに実際に入る文字」、
 * USモードは素のUS配列の表記。表の出発点はreference/keymap-preview.htmlの
 * JIS / NAMEDオブジェクト(HANDOFF §7)。
 */
import type { Keycode } from './decode'
import {
  decodeKeycode,
  formatKeycode,
  hasShift,
  MOD_ALT,
  MOD_CTRL,
  MOD_GUI,
  MOD_RIGHT,
  MOD_SHIFT
} from './decode'

export type LabelMode = 'jis' | 'us'

export type LabelCategory =
  | 'alpha'
  | 'num'
  | 'sym'
  | 'mod'
  | 'fn'
  | 'named'
  | 'layer'
  | 'user'
  | 'none'

export interface KeyLabel {
  /** キートップに大きく出す文字。 */
  main: string
  /** Shiftを足したときに出る文字。無ければundefined。 */
  shift?: string
  /** 小さく添える補足。 */
  sub?: string
  /**
   * ツールチップにだけ出す説明。カスタムキーのtitle("Switch default output mode between
   * USB/BLE"など)は長く、キーの中に書くとはみ出すので、補足とは分けて持つ。
   */
  description?: string
  category: LabelCategory
}

/** 印字キー:[通常, Shift]。nullは「Shiftでも変わらない/何も出ない」。 */
type Printable = readonly [string, string | null]

/** JIS配列(Windowsが日本語キーボードとして扱っているとき)に実際に入る文字。 */
export const JIS_PRINTABLE: Readonly<Record<string, Printable>> = {
  KC_1: ['1', '!'],
  KC_2: ['2', '"'],
  KC_3: ['3', '#'],
  KC_4: ['4', '$'],
  KC_5: ['5', '%'],
  KC_6: ['6', '&'],
  KC_7: ['7', "'"],
  KC_8: ['8', '('],
  KC_9: ['9', ')'],
  KC_0: ['0', null],
  KC_MINUS: ['-', '='],
  KC_EQUAL: ['^', '~'],
  KC_JYEN: ['¥', '|'],
  KC_LBRACKET: ['@', '`'],
  KC_RBRACKET: ['[', '{'],
  KC_SCOLON: [';', '+'],
  KC_QUOTE: [':', '*'],
  KC_NONUS_HASH: [']', '}'],
  KC_COMMA: [',', '<'],
  KC_DOT: ['.', '>'],
  KC_SLASH: ['/', '?'],
  KC_RO: ['\\', '_'],
  KC_GRAVE: ['半/全', null]
}

/** US配列の表記。 */
export const US_PRINTABLE: Readonly<Record<string, Printable>> = {
  KC_1: ['1', '!'],
  KC_2: ['2', '@'],
  KC_3: ['3', '#'],
  KC_4: ['4', '$'],
  KC_5: ['5', '%'],
  KC_6: ['6', '^'],
  KC_7: ['7', '&'],
  KC_8: ['8', '*'],
  KC_9: ['9', '('],
  KC_0: ['0', ')'],
  KC_MINUS: ['-', '_'],
  KC_EQUAL: ['=', '+'],
  KC_LBRACKET: ['[', '{'],
  KC_RBRACKET: [']', '}'],
  KC_BSLASH: ['\\', '|'],
  KC_SCOLON: [';', ':'],
  KC_QUOTE: ["'", '"'],
  KC_GRAVE: ['`', '~'],
  KC_COMMA: [',', '<'],
  KC_DOT: ['.', '>'],
  KC_SLASH: ['/', '?'],
  KC_NONUS_HASH: ['#', '~'],
  KC_NONUS_BSLASH: ['\\', '|'],
  // US配列には無いが、キーマップ上には置ける
  KC_JYEN: ['¥', '|'],
  KC_RO: ['\\', '_']
}

interface Named {
  main: string
  sub?: string
  category?: LabelCategory
  /** USモードでの差し替え。 */
  us?: { main?: string; sub?: string }
}

/** 印字キー以外の表示名。 */
export const NAMED: Readonly<Record<string, Named>> = {
  KC_TAB: { main: 'Tab' },
  KC_ESCAPE: { main: 'Esc' },
  KC_ENTER: { main: 'Enter' },
  KC_SPACE: { main: 'Space' },
  KC_BSPACE: { main: 'BS' },
  KC_DELETE: { main: 'Del' },
  KC_INSERT: { main: 'Ins' },
  KC_CAPSLOCK: { main: 'Caps' },
  KC_PSCREEN: { main: 'PrtSc' },
  KC_APPLICATION: { main: 'Menu' },

  KC_LCTRL: { main: 'Ctrl', category: 'mod' },
  KC_RCTRL: { main: 'Ctrl', sub: '右', category: 'mod', us: { sub: 'R' } },
  KC_LSHIFT: { main: 'Shift', category: 'mod' },
  KC_RSHIFT: { main: 'Shift', sub: '右', category: 'mod', us: { sub: 'R' } },
  KC_LALT: { main: 'Alt', category: 'mod' },
  KC_RALT: { main: 'Alt', sub: '右', category: 'mod', us: { sub: 'R' } },
  KC_LGUI: { main: 'Win', category: 'mod' },
  KC_RGUI: { main: 'Win', sub: '右', category: 'mod', us: { sub: 'R' } },

  KC_LANG1: { main: 'かな', sub: 'IME オン', us: { main: 'Lang1', sub: 'Kana' } },
  KC_LANG2: { main: '英数', sub: 'IME オフ', us: { main: 'Lang2', sub: 'Eisu' } },

  KC_LEFT: { main: '←' },
  KC_RIGHT: { main: '→' },
  KC_UP: { main: '↑' },
  KC_DOWN: { main: '↓' },
  KC_HOME: { main: 'Home' },
  KC_END: { main: 'End' },
  KC_PGUP: { main: 'PgUp' },
  KC_PGDOWN: { main: 'PgDn' },

  KC_MS_L: { main: '←', sub: 'マウス移動', us: { sub: 'Mouse' } },
  KC_MS_R: { main: '→', sub: 'マウス移動', us: { sub: 'Mouse' } },
  KC_MS_U: { main: '↑', sub: 'マウス移動', us: { sub: 'Mouse' } },
  KC_MS_D: { main: '↓', sub: 'マウス移動', us: { sub: 'Mouse' } },
  KC_BTN1: { main: '左', sub: 'クリック', us: { main: 'L', sub: 'Click' } },
  KC_BTN2: { main: '右', sub: 'クリック', us: { main: 'R', sub: 'Click' } },
  KC_BTN3: { main: '中', sub: 'クリック', us: { main: 'M', sub: 'Click' } },
  KC_WH_U: { main: '↑', sub: 'ホイール', us: { sub: 'Wheel' } },
  KC_WH_D: { main: '↓', sub: 'ホイール', us: { sub: 'Wheel' } },
  KC_ACL0: { main: '遅', sub: 'マウス速度', us: { main: 'Acl0', sub: 'Speed' } },
  KC_ACL1: { main: '中', sub: 'マウス速度', us: { main: 'Acl1', sub: 'Speed' } },
  KC_ACL2: { main: '速', sub: 'マウス速度', us: { main: 'Acl2', sub: 'Speed' } },

  KC_MUTE: { main: '消音', sub: 'ミュート', us: { main: 'Mute' } },
  KC_VOLU: { main: '音量+', us: { main: 'Vol+' } },
  KC_VOLD: { main: '音量−', us: { main: 'Vol-' } },
  KC_MPLY: { main: '再生', us: { main: 'Play' } },
  KC_MNXT: { main: '次', us: { main: 'Next' } },
  KC_MPRV: { main: '前', us: { main: 'Prev' } }
}

/** ラベルを出すのに要る、キーボードから読んだ情報。 */
export interface LabelContext {
  /** 定義JSONのcustomKeycodes(USER00… の表示名)。 */
  customKeycodes?: ReadonlyArray<{ name?: string; title?: string; shortName?: string }>
  /** Tap Danceの設定。TD(n)をタップ側の文字で出すのに使う。読んでいない枠はundefined。 */
  tapDance?: ReadonlyArray<{ onTap: number; onHold: number } | undefined>
}

function printableTable(mode: LabelMode): Readonly<Record<string, Printable>> {
  return mode === 'jis' ? JIS_PRINTABLE : US_PRINTABLE
}

function namedLabel(name: string, mode: LabelMode): KeyLabel | null {
  const entry = NAMED[name]
  if (entry === undefined) return null
  const over = mode === 'us' ? entry.us : undefined
  return {
    main: over?.main ?? entry.main,
    sub: over?.sub ?? entry.sub,
    category: entry.category ?? 'named'
  }
}

/** 名前テーブルにも印字テーブルにも無いキーコードの、最後の手段。 */
function fallbackLabel(name: string): KeyLabel {
  return { main: name.replace(/^KC_/, ''), category: 'named' }
}

function basicLabel(name: string, mode: LabelMode): KeyLabel {
  const alpha = /^KC_([A-Z])$/.exec(name)
  if (alpha) return { main: alpha[1], category: 'alpha' }

  const fn = /^KC_F(\d{1,2})$/.exec(name)
  if (fn) return { main: `F${fn[1]}`, category: 'fn' }

  const printable = printableTable(mode)[name]
  if (printable !== undefined) {
    const isDigit = /^KC_\d$/.test(name)
    return {
      main: printable[0],
      shift: printable[1] ?? undefined,
      category: isDigit ? 'num' : 'sym'
    }
  }

  return namedLabel(name, mode) ?? fallbackLabel(name)
}

function modsLabel(mods: number): string {
  const side = (mods & MOD_RIGHT) !== 0 ? '右' : ''
  const parts: string[] = []
  if (mods & MOD_CTRL) parts.push('Ctrl')
  if (mods & MOD_SHIFT) parts.push('Shift')
  if (mods & MOD_ALT) parts.push('Alt')
  if (mods & MOD_GUI) parts.push('Win')
  return side + parts.join('+')
}

/**
 * キーコード1個分のラベルを作る。
 *
 * Layer-Tap / Tap Danceなど「押すと出る文字」と「長押しの機能」を両方持つキーは、
 * ここでは**タップ側の文字**を返す。長押し側の表現は呼び出し元(KeyCap)が担当する。
 */
export function labelForKeycode(kc: Keycode, mode: LabelMode, ctx: LabelContext = {}): KeyLabel {
  switch (kc.kind) {
    case 'none':
      return { main: '', category: 'none' }
    case 'trns':
      return { main: '▽', category: 'none' }
    case 'basic':
      return basicLabel(kc.name, mode)

    case 'mods': {
      // Shift +印字キーは、そのShift面の文字そのものを出す(JISの記号レイヤー対策)
      if (kc.mods === MOD_SHIFT && kc.inner.kind === 'basic') {
        const printable = printableTable(mode)[kc.inner.name]
        if (printable?.[1]) return { main: printable[1], category: 'sym' }
      }
      const inner = labelForKeycode(kc.inner, mode, ctx)
      return { main: inner.main, sub: modsLabel(kc.mods), category: inner.category }
    }

    case 'modTap': {
      const inner = labelForKeycode(kc.inner, mode, ctx)
      return { ...inner, sub: `長押し ${modsLabel(kc.mods)}` }
    }

    case 'layerTap':
      return labelForKeycode(kc.inner, mode, ctx)

    case 'layerMod':
      return { main: `L${kc.layer}`, sub: modsLabel(kc.mods), category: 'layer' }

    case 'layer':
      return { main: `${kc.op}${kc.layer}`, sub: layerOpSub(kc.op), category: 'layer' }

    case 'oneShotMod':
      return { main: modsLabel(kc.mods), sub: 'ワンショット', category: 'mod' }

    case 'tapDance': {
      // TDはタップ側の文字を出す。長押し側の表現は呼び出し元が担当する
      const entry = ctx.tapDance?.[kc.index]
      if (entry) return labelForKeycode(decodeKeycode(entry.onTap), mode, ctx)
      return { main: `TD${kc.index}`, category: 'layer' }
    }

    case 'macro':
      return { main: `M${kc.index}`, category: 'named' }

    case 'user': {
      const custom = ctx.customKeycodes?.[kc.index]
      if (custom) {
        // shortNameは"Switch\nOutput"のように改行入りで来ることがある
        const short = (custom.shortName ?? custom.name ?? '').replace(/\n/g, ' ')
        return { main: short || `USER${kc.index}`, description: custom.title, category: 'user' }
      }
      return { main: `USER${String(kc.index).padStart(2, '0')}`, category: 'user' }
    }

    case 'unknown':
      return { main: formatKeycode(kc), category: 'named' }
  }
}

function layerOpSub(op: string): string {
  switch (op) {
    case 'TO':
      return '切替'
    case 'MO':
      return '押している間'
    case 'DF':
      return '既定レイヤー'
    case 'TG':
      return 'トグル'
    case 'OSL':
      return 'ワンショット'
    case 'TT':
      return 'タップトグル'
    case 'PDF':
      return '既定(保存)'
    default:
      return ''
  }
}

export { hasShift }
