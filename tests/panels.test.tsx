/** ツールバーや案内など、キーボード図以外の部品を静的に描いて確かめる。 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LayerStrip } from '@/components/LayerStrip'
import { LoadingPanel } from '@/components/LoadingPanel'
import { ModifierBadges } from '@/components/ModifierBadges'
import { OverlayControls } from '@/components/OverlayControls'
import { PreviewNotice } from '@/components/PreviewNotice'
import { SettingsPanel } from '@/components/SettingsPanel'
import { SymbolFinder } from '@/components/SymbolFinder'
import { UnlockPanel } from '@/components/UnlockPanel'
import { Button } from '@/components/ui/Button'
import { describeTrigger, type LayerSummary, type LayerTrigger } from '@/engine/layerSummary'
import { routeSteps } from '@/engine/symbolRoutes'
import { overlayFaded } from '@/hooks/useOverlayFade'
import {
  decodeKeycode,
  MOD_CTRL,
  MOD_SHIFT,
  QK_LAYER_TAP,
  QK_MOMENTARY,
  QK_TOGGLE_LAYER
} from '@/keycodes/decode'

describe('LoadingPanel', () => {
  it('読み込み中は、段の名前と何往復目かを出す', () => {
    const html = renderToStaticMarkup(
      <LoadingPanel deviceLabel="Cornix" progress={{ stage: 'keymap', done: 12, total: 40 }} />
    )
    expect(html).toContain('Cornix を読み込み中')
    expect(html).toContain('キーマップ')
    expect(html).toContain('12 / 40')
    expect(html).toContain('width:30%')
  })

  it('読み込みに入る前は「接続中」と、確かめている相手を出す', () => {
    const html = renderToStaticMarkup(
      <LoadingPanel deviceLabel="応答するインターフェースを確認中" progress={null} />
    )
    expect(html).toContain('接続中')
    expect(html).toContain('応答するインターフェースを確認中')
  })
})

const noop = () => undefined

/** Cornix と同じく、L0〜L4 に中身があり L5〜L9 は空、という一覧。 */
function cornixLike(triggers: Partial<Record<number, LayerTrigger[]>> = {}): LayerSummary[] {
  return Array.from({ length: 10 }, (_, layer) => ({
    layer,
    triggers: triggers[layer] ?? [],
    blank: layer >= 5
  }))
}

function strip(props: Partial<Parameters<typeof LayerStrip>[0]> = {}): string {
  return renderToStaticMarkup(
    <LayerStrip
      summaries={cornixLike()}
      activeLayers={[0, 2]}
      shownLayer={2}
      preview={null}
      labelMode="jis"
      labelContext={{}}
      onPreview={noop}
      onHover={noop}
      {...props}
    />
  )
}

describe('LayerStrip', () => {
  it('出しているレイヤーは塗り、ほかに有効なものは薄く塗り、無効なものは枠だけにする', () => {
    const html = strip()
    expect(html).toContain('background-color:var(--color-layer-2)')
    expect(html).toContain(
      'background-color:color-mix(in srgb, var(--color-layer-0) 28%, transparent)'
    )
    expect(html).not.toContain('background-color:var(--color-layer-1)')
  })

  it('中身の無いレイヤーは「+5 空」に畳む', () => {
    const html = strip()
    expect(html.match(/>L\d</g)).toEqual(['>L0<', '>L1<', '>L2<', '>L3<', '>L4<'])
    expect(html).toContain('+5 空')
  })

  it('空のレイヤーでも、有効になっていれば畳まずに出す', () => {
    const html = strip({ activeLayers: [0, 7], shownLayer: 7 })
    expect(html).toContain('>L7<')
    expect(html).toContain('+4 空')
  })

  it('そのレイヤーへの行き方を添える', () => {
    const space: LayerTrigger = {
      fromLayer: 0,
      row: 7,
      col: 5,
      kind: 'hold',
      keycode: decodeKeycode(QK_LAYER_TAP | (2 << 8) | 0x2c) // LT2(KC_SPACE)
    }
    const html = strip({ summaries: cornixLike({ 2: [space] }) })
    expect(html).toContain('>Space 長押し<')
    expect(html).toContain('title="L2: Space 長押し。')
  })

  it('名前があれば番号の横に出す', () => {
    const html = strip({ names: ['基本', '', '記号'], onRename: noop })
    expect(html).toContain('<span>L0</span><span class="font-medium max-md:hidden">基本</span>')
    expect(html).toContain('<span>L2</span><span class="font-medium max-md:hidden">記号</span>')
    expect(html).toContain('ダブルクリックで名前を付ける')
  })
})

describe('describeTrigger', () => {
  const at = (fromLayer: number, raw: number, kind: LayerTrigger['kind']) =>
    describeTrigger({ fromLayer, row: 0, col: 0, kind, keycode: decodeKeycode(raw) }, 'jis', {})

  it('LT はタップ側の文字、TG はキーの名前で言い、ベース以外にあるキーはレイヤーを先に書く', () => {
    expect(at(0, QK_LAYER_TAP | (1 << 8) | 0x2a, 'hold')).toBe('BS 長押し')
    expect(at(0, QK_TOGGLE_LAYER | 3, 'toggle')).toBe('TG3 で固定')
    expect(at(1, QK_MOMENTARY | 4, 'momentary')).toBe('L1 → MO4 押す間')
  })
})

describe('PreviewNotice', () => {
  it('押して固定したプレビューは、戻り方と「戻る」を出す', () => {
    const html = renderToStaticMarkup(<PreviewNotice layer={5} pinned onExit={noop} />)
    expect(html).toContain('をプレビュー中')
    expect(html).toContain('キーを押すか Esc で戻る')
    expect(html).toContain('>戻る<')
  })

  it('ポインタを乗せているだけなら「戻る」は出さない', () => {
    const html = renderToStaticMarkup(
      <PreviewNotice layer={3} name="記号" pinned={false} onExit={noop} />
    )
    expect(html).toContain('L3 記号')
    expect(html).toContain('ポインタを外すと戻る')
    expect(html).not.toContain('>戻る<')
  })
})

describe('オーバーレイの自動フェード', () => {
  const base = { autoFade: true, shownLayer: 0, shift: false, status: 'ready', error: null }

  it('ベースレイヤーで何も押していなければ薄くする', () => {
    expect(overlayFaded(base)).toBe(true)
  })

  it('ほかのレイヤー・Shift・案内が出ているとき・無効にしたときは薄くしない', () => {
    expect(overlayFaded({ ...base, shownLayer: 2 })).toBe(false)
    expect(overlayFaded({ ...base, shift: true })).toBe(false)
    expect(overlayFaded({ ...base, status: 'unlocking' })).toBe(false)
    expect(overlayFaded({ ...base, error: 'デバイスが応答しない' })).toBe(false)
    expect(overlayFaded({ ...base, autoFade: false })).toBe(false)
  })

  const overlaySettings = {
    overlayOpacity: 0.8,
    overlayAutoFade: true,
    overlayFadedOpacity: 0.35,
    overlayBlur: false
  }
  const controls = (
    settings: Partial<typeof overlaySettings> = {},
    props: Partial<Parameters<typeof OverlayControls>[0]> = {}
  ) =>
    renderToStaticMarkup(
      <OverlayControls
        displayLayer={0}
        settings={{ ...overlaySettings, ...settings }}
        onChange={noop}
        blurSupported={true}
        onExit={noop}
        {...props}
      />
    )

  it('操作パネルに切り替えのチェックボックスを出す', () => {
    const html = controls()
    expect(html).toContain('L0 で薄く')
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
    // ふだんは畳んでおき、ポインタを乗せたら広げる
    // (cn が display のぶつかりを解くので、flex は消えて hidden だけが残る)
    expect(html).toMatch(/class="[^"]*hidden"/)
  })

  it('薄くしたときの濃さを選べる。薄くしないなら押せない', () => {
    expect(controls()).toMatch(/type="range"[^>]*value="35"/)
    expect(controls({ overlayAutoFade: false })).toMatch(
      /type="range"[^>]*disabled=""[^>]*value="35"/
    )
  })

  it('後ろのぼかしは、使えるときだけ欄を出す', () => {
    expect(controls()).toContain('後ろをぼかす')
    expect(controls({}, { blurSupported: false })).not.toContain('後ろをぼかす')
  })
})

describe('Button', () => {
  it('渡したクラスが既定のクラスとぶつかれば、渡した方が勝つ', () => {
    const html = renderToStaticMarkup(<Button className="bg-raised">戻す</Button>)
    expect(html).toContain('bg-raised')
    expect(html).not.toContain('bg-surface ')
    expect(html).toContain('type="button"')
  })

  it('主ボタンはレイヤー色を使わない(レイヤーの表示と見分けが付かなくなる)', () => {
    const html = renderToStaticMarkup(<Button variant="primary">接続</Button>)
    expect(html).not.toMatch(/layer-\d/)
  })
})

describe('ModifierBadges', () => {
  it('4 つとも並べ、効いているものだけ点ける', () => {
    const html = renderToStaticMarkup(<ModifierBadges mods={MOD_CTRL | MOD_SHIFT} />)
    const on = [...html.matchAll(/title="(\w+)[^"]*" data-on="(true|false)"/g)].map((m) => [
      m[1],
      m[2]
    ])
    expect(on).toEqual([
      ['Ctrl', 'true'],
      ['Shift', 'true'],
      ['Alt', 'false'],
      ['Win', 'false']
    ])
  })
})

describe('UnlockPanel', () => {
  const unlock = {
    keys: [
      { row: 0, col: 0 },
      { row: 0, col: 1 }
    ],
    counter: 25,
    max: 50
  }

  it('押すキーを名前で言う', () => {
    const html = renderToStaticMarkup(<UnlockPanel unlock={unlock} keyNames={['Tab', 'Q']} />)
    expect(html).toMatch(/<kbd[^>]*>Tab<\/kbd> と <kbd[^>]*>Q<\/kbd> を同時に、/)
    expect(html).toContain('width:50%')
  })

  it('名前が分からなければ図を指す', () => {
    const html = renderToStaticMarkup(<UnlockPanel unlock={unlock} />)
    expect(html).toContain('図で白い破線が回っているキー')
  })
})

describe('SettingsPanel', () => {
  const panelSettings = {
    encoderPlacement: 'top',
    tappingTerm: 250,
    grantedDevices: [{ vendorId: 0xe118, productId: 1, name: 'Cornix LP' }],
    overlayOpacity: 0.6,
    overlayAutoFade: false,
    overlayFadedOpacity: 0.2,
    overlayBlur: false
  } as const
  const panel = (props: Partial<Parameters<typeof SettingsPanel>[0]> = {}) =>
    renderToStaticMarkup(
      <SettingsPanel
        layers={[
          { layer: 0, how: null },
          { layer: 2, how: 'Space 長押し' }
        ]}
        names={['', '', '記号']}
        onRename={noop}
        settings={{ ...panelSettings, grantedDevices: [...panelSettings.grantedDevices] }}
        onChange={noop}
        blurSupported={false}
        {...props}
      />
    )

  it('中身のあるレイヤーに名前の欄を出し、行き方を薄く添える', () => {
    const html = panel()
    expect(html).toContain('aria-label="L0 の名前"')
    expect(html).toContain('aria-label="L2 の名前"')
    expect(html).toMatch(/placeholder="Space 長押し"[^>]*value="記号"/)
  })

  it('繋いでいなければ名前の欄の代わりに案内を出す', () => {
    const html = panel({ layers: [], onRename: undefined })
    expect(html).not.toContain('の名前"')
    expect(html).toContain('キーボードに繋ぐと付けられる')
  })

  it('ノブの位置とオーバーレイの設定は、いまの値を選んだ状態で出す', () => {
    const html = panel()
    expect(html).toMatch(/aria-pressed="true"[^>]*>図の上</)
    expect(html).toContain('value="60"')
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/)
  })

  it('長押しの判定時間を ms で出す', () => {
    const html = panel()
    expect(html).toMatch(/type="range" min="100" max="500" step="10"[^>]*value="250"/)
    expect(html).toContain('>250 ms<')
  })

  it('許可したキーボードを並べ、保存できるときだけ「忘れる」を出す', () => {
    expect(panel()).toContain('Cornix LP')
    expect(panel()).toContain('e118:0001')
    expect(panel()).not.toContain('>忘れる<')
    expect(panel({ onForgetDevice: noop })).toContain('>忘れる<')
    expect(panel({ settings: { ...panelSettings, grantedDevices: [] } })).toContain('まだ無い')
  })

  it('後ろのぼかしは、使えない OS では押せなくしてそう書く', () => {
    expect(panel()).toMatch(/type="checkbox"[^>]*disabled=""/)
    expect(panel()).toContain('Windows 11 でだけ使える')
    expect(panel({ blurSupported: true })).toContain('強さは OS が決める')
  })
})

describe('SymbolFinder', () => {
  const route = (layer: number, shift = false, tap = false) => ({
    layer,
    row: 0,
    col: 1,
    shift,
    tap,
    cost: (layer > 0 ? 1 : 0) + (shift ? 1 : 0)
  })

  it('記号ごとに一番手数の少ない打ち方を出し、出せない記号は押せなくする', () => {
    const routes = new Map([
      ['@', [route(2)]],
      ['<', [route(0, true)]],
      ['¥', []]
    ])
    const html = renderToStaticMarkup(
      <SymbolFinder
        routes={routes}
        stepsOf={(r) =>
          routeSteps(r, r.layer === 2 ? 'W' : ',', r.layer === 2 ? 'Space 長押し' : null)
        }
        onPick={noop}
      />
    )
    // 一覧ではレイヤーを番号で短く出し、ツールチップで行き方まで言う
    expect(html).toMatch(/title="Space 長押し \+ W"/)
    expect(html).toContain('>L2<')
    expect(html).toContain('>Shift<')
    expect(html).toMatch(/disabled=""[^>]*title="このキーマップでは出せない"/)
  })

  it('タップと長押しを兼ねるキーは「タップ」と添える', () => {
    expect(routeSteps(route(0, false, true), '`', null)).toEqual([
      { kind: 'key', text: '` タップ' }
    ])
  })
})
