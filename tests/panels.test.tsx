/** ツールバーや案内など、キーボード図以外の部品を静的に描いて確認する。 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LayerStrip } from '@/components/LayerStrip'
import { LoadingPanel } from '@/components/LoadingPanel'
import { ModifierBadges } from '@/components/ModifierBadges'
import { OverlayControls } from '@/components/OverlayControls'
import { PreviewNotice } from '@/components/PreviewNotice'
import { SettingsPanel } from '@/components/SettingsPanel'
import { SymbolFinder } from '@/components/SymbolFinder'
import { Toolbar, type ToolbarProps } from '@/components/Toolbar'
import { UnlockPanel } from '@/components/UnlockPanel'
import { Button } from '@/components/ui/Button'
import { describeTrigger, type LayerSummary, type LayerTrigger } from '@/engine/layerSummary'
import { routeSteps } from '@/engine/symbolRoutes'
import { toAppUpdate } from '@/hooks/useAppUpdate'
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
    expect(html).toContain('Cornixを読み込み中')
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

/** Cornixと同じく、L0〜L4に中身がありL5〜L9は空、という一覧。 */
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

describe('Toolbarの接続の状態', () => {
  const toolbar = (props: Partial<ToolbarProps>): string =>
    renderToStaticMarkup(
      <Toolbar
        status="ready"
        deviceLabel="Cornix"
        settings={null}
        mods={null}
        stalled={false}
        labelMode="jis"
        windowMode="normal"
        reloading={false}
        onReload={() => undefined}
        onDisconnect={() => undefined}
        onLabelMode={() => undefined}
        onToggleWindowMode={() => undefined}
        {...props}
      />
    )
  const spinning = (html: string): boolean => html.includes('animate-spin')

  it('新しい版があるときだけ、設定ボタンに印を付ける', () => {
    expect(toolbar({ settingsBadge: true })).toContain('新しい版があります')
    expect(toolbar({})).not.toContain('新しい版があります')
  })

  it('繋いでいる・読み込んでいる・読み直しているあいだは、丸ではなく回る印を出す', () => {
    // 緑の丸のままだと、読んでいる最中だと分からない
    expect(spinning(toolbar({ status: 'connecting' }))).toBe(true)
    const loading = toolbar({ status: 'loading' })
    expect(spinning(loading)).toBe(true)
    expect(loading).toContain('text-warn') // 色は丸と同じ(読み込みは黄)
    const reloading = toolbar({ reloading: true })
    expect(spinning(reloading)).toBe(true)
    expect(reloading).toContain('text-ok') // 読み直しは接続したままなので緑
    expect(reloading).not.toContain('bg-ok') // 丸は出さない
  })

  it('繋がっているだけ・応答待ち・アンロック中は丸のまま', () => {
    expect(toolbar({})).toContain('bg-ok')
    expect(spinning(toolbar({}))).toBe(false)
    // 応答待ちは読み進んでいないので回さない(読み直しの途中で詰まっても)
    const stalled = toolbar({ reloading: true, stalled: true })
    expect(spinning(stalled)).toBe(false)
    expect(stalled).toContain('bg-warn')
    expect(spinning(toolbar({ status: 'unlocking' }))).toBe(false)
  })

  it('切り替えのボタンに、設定したショートカットを添える', () => {
    expect(toolbar({})).toContain('Ctrl+Alt+Kでも切り替えられます')
    expect(toolbar({ toggleShortcut: 'Alt+Super+O' })).toContain('Alt+Win+O')
  })

  it('往復時間が分かれば、状態のツールチップにデバイス名と続けて添える', () => {
    expect(toolbar({ roundTripMs: 470 })).toContain('title="接続済み Cornix(往復470ms)"')
    expect(toolbar({})).toContain('title="接続済み Cornix"')
  })
})

describe('LayerStrip', () => {
  it('出しているレイヤーは塗り、ほかに有効なものは薄く塗り、無効なものは枠だけにする', () => {
    const html = strip()
    expect(html).toContain('background-color:var(--color-layer-2)')
    expect(html).toContain(
      'background-color:color-mix(in srgb, var(--color-layer-0) 28%, transparent)'
    )
    expect(html).not.toContain('background-color:var(--color-layer-1)')
  })

  it('中身の無いレイヤーは「+5空」に畳む', () => {
    const html = strip()
    expect(html.match(/>L\d</g)).toEqual(['>L0<', '>L1<', '>L2<', '>L3<', '>L4<'])
    expect(html).toContain('+5空')
  })

  it('空のレイヤーでも、有効になっていれば畳まずに出す', () => {
    const html = strip({ activeLayers: [0, 7], shownLayer: 7 })
    expect(html).toContain('>L7<')
    expect(html).toContain('+4空')
  })

  it('行き方は既定ではツールチップだけに出し、設定で番号の横にも並べられる', () => {
    // 常に並べるとツールバーが詰まり、狭いウィンドウではレイヤーが横に流れて見切れていた
    const space: LayerTrigger = {
      fromLayer: 0,
      row: 7,
      col: 5,
      kind: 'hold',
      keycode: decodeKeycode(QK_LAYER_TAP | (2 << 8) | 0x2c) // LT2(KC_SPACE)
    }
    const hidden = strip({ summaries: cornixLike({ 2: [space] }) })
    expect(hidden).not.toContain('>Space長押し<')
    expect(hidden).toContain('title="L2: Space長押し。')

    const shown = strip({ summaries: cornixLike({ 2: [space] }), showTriggers: true })
    expect(shown).toContain('>Space長押し<')
    expect(shown).toContain('title="L2: Space長押し。')
  })

  it('名前があれば番号の横に出す', () => {
    const html = strip({ names: ['基本', '', '記号'], onRename: noop })
    expect(html).toContain('<span>L0</span><span class="font-medium max-md:hidden">基本</span>')
    expect(html).toContain('<span>L2</span><span class="font-medium max-md:hidden">記号</span>')
    expect(html).toContain('ダブルクリックで名前を付けられます')
  })
})

describe('describeTrigger', () => {
  const at = (fromLayer: number, raw: number, kind: LayerTrigger['kind']) =>
    describeTrigger({ fromLayer, row: 0, col: 0, kind, keycode: decodeKeycode(raw) }, 'jis', {})

  it('LTはタップ側の文字、TGはキーの名前で言い、ベース以外にあるキーはレイヤーを先に書く', () => {
    expect(at(0, QK_LAYER_TAP | (1 << 8) | 0x2a, 'hold')).toBe('BS長押し')
    expect(at(0, QK_TOGGLE_LAYER | 3, 'toggle')).toBe('TG3で固定')
    expect(at(1, QK_MOMENTARY | 4, 'momentary')).toBe('L1 → MO4押している間')
  })
})

describe('PreviewNotice', () => {
  it('押して固定したプレビューは、戻り方と「戻る」を出す', () => {
    const html = renderToStaticMarkup(<PreviewNotice layer={5} pinned onExit={noop} />)
    expect(html).toContain('をプレビュー中')
    expect(html).toContain('キーを押すかEscで戻ります')
    expect(html).toContain('>戻る<')
  })

  it('ポインタを乗せているだけなら「戻る」は出さない', () => {
    const html = renderToStaticMarkup(
      <PreviewNotice layer={3} name="記号" pinned={false} onExit={noop} />
    )
    expect(html).toContain('L3記号')
    expect(html).toContain('ポインタを外すと戻ります')
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
    expect(overlayFaded({ ...base, error: 'デバイスが応答しません' })).toBe(false)
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
    expect(html).toContain('L0で薄く')
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
    // ふだんは畳んでおき、ポインタを乗せたら広げる
    // (cnがdisplayのぶつかりを解くので、flexは消えてhiddenだけが残る)
    expect(html).toMatch(/class="[^"]*hidden"/)
  })

  it('薄くしたときの濃さを選べる。薄くしないなら押せない', () => {
    expect(controls()).toMatch(/type="range"[^>]*value="35"/)
    expect(controls({ overlayAutoFade: false })).toMatch(
      /type="range"[^>]*disabled=""[^>]*value="35"/
    )
  })

  it('応答が途切れたら、畳んでいても「応答待ち」を出し、パネルを濃くする', () => {
    expect(controls()).not.toContain('応答待ち')
    const html = controls({}, { stalled: true })
    expect(html).toContain('応答待ち')
    expect(html).toContain('opacity-100')
    expect(html).not.toContain('opacity-45')
  })

  it('キーマップを読み直せる。押下を読んでいないときと、読み直している最中は押せない', () => {
    expect(controls()).not.toContain('キーマップを読み直す')
    const reload = (props: Partial<Parameters<typeof OverlayControls>[0]>) =>
      controls({}, { onReload: noop, ...props })
    expect(reload({ canReload: true })).toMatch(
      /<button[^>]*type="button"[^>]*>キーマップを読み直す/
    )
    expect(reload({ canReload: false })).toMatch(/disabled=""[^>]*>キーマップを読み直す/)
    expect(reload({ canReload: true, reloading: true })).toMatch(/disabled=""[^>]*>読み直し中…/)
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
  it('4つとも並べ、効いているものだけ点ける', () => {
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
    expect(html).toMatch(
      /<kbd[^>]*>Tab<\/kbd><span[^>]*>と<\/span><kbd[^>]*>Q<\/kbd><span[^>]*>を同時に、/
    )
    expect(html).toContain('width:50%')
  })

  it('名前が分からなければ図を指す', () => {
    const html = renderToStaticMarkup(<UnlockPanel unlock={unlock} />)
    expect(html).toContain('図で白い破線が回っているキー')
  })
})

describe('SettingsPanel', () => {
  const panelSettings = {
    tappingTerm: 250,
    toggleShortcut: 'Ctrl+Alt+K',
    grantedDevices: [{ vendorId: 0xe118, productId: 1, name: 'Cornix LP' }],
    overlayOpacity: 0.6,
    overlayAutoFade: false,
    overlayFadedOpacity: 0.2,
    overlayBlur: false,
    showLayerTriggers: false
  } as const
  const panel = (props: Partial<Parameters<typeof SettingsPanel>[0]> = {}) =>
    renderToStaticMarkup(
      <SettingsPanel
        layers={[
          { layer: 0, how: null },
          { layer: 2, how: 'Space長押し' }
        ]}
        names={['', '', '記号']}
        onRename={noop}
        settings={{ ...panelSettings, grantedDevices: [...panelSettings.grantedDevices] }}
        onChange={noop}
        blurSupported={false}
        {...props}
      />
    )

  it('切り替えのショートカットを出す。変えていれば既定に戻せる', () => {
    const html = panel()
    expect(html).toContain('Ctrl+Alt+K')
    expect(html).not.toContain('既定に戻す')
    const changed = panel({
      settings: { ...panelSettings, toggleShortcut: 'Ctrl+Super+F9', grantedDevices: [] }
    })
    expect(changed).toContain('Ctrl+Win+F9')
    expect(changed).toContain('既定に戻す')
  })

  it('ショートカットを登録できなかったら(ほかのアプリが使っている)、別の組み合わせを勧める', () => {
    expect(panel()).not.toContain('ほかのアプリが使っている')
    expect(panel({ shortcutRegistered: false })).toContain('ほかのアプリが使っているため')
  })

  it('長押しの判定時間をキーボードから読めていれば、スライダーを止めてその値を出す', () => {
    expect(panel()).not.toContain('msで判定しています')
    const html = panel({ keyboardTappingTerm: 280 })
    expect(html).toContain('キーボードに設定された280msで判定しています')
    expect(html).toMatch(/type="range"[^>]*disabled=""[^>]*value="250"/)
  })

  it('ツールバーの節に、レイヤーの行き方を添えるかのチェックを出す', () => {
    const html = panel()
    expect(html).toContain('ツールバー')
    expect(html).toContain('レイヤーの行き方を添える')
    expect(html).toMatch(
      /<input type="checkbox"(?![^>]*checked)[^>]*>[^<]*<span>レイヤーの行き方を添える/
    )
  })

  it('どのビルドが動いているかと、ログの置き場所を出す', () => {
    // WSLで作ってWindowsに置くので、「直した版が動いているのか」が分からなくなる
    const html = panel({
      appInfo: {
        version: '0.1.0',
        runtime: 'WebView2 153.0.4234.48',
        buildTime: '2026-09-23T10:48:00.000Z',
        logPath: 'C:\\Users\\masato\\AppData\\Roaming\\live-keymap-viewer\\log.txt'
      }
    })
    expect(html).toContain('このアプリ')
    expect(html).toContain('v0.1.0')
    expect(html).toContain('WebView2 153.0.4234.48')
    expect(html).toContain('log.txt')
  })

  it('ビルドの情報が取れていなければ、その欄は出さない', () => {
    expect(panel()).not.toContain('このアプリ')
  })

  describe('更新', () => {
    const appInfo = { version: '0.1.0', runtime: 'WebView2', buildTime: '', logPath: 'log.txt' }

    it('インストーラーで入れていなければ、ボタンは出さずに理由だけ添える', () => {
      const html = panel({ appInfo, update: { phase: 'unsupported' } })
      expect(html).toContain('インストーラーで入れたときに使えます')
      expect(html).not.toContain('更新を確認')
    })

    it('新しい版があれば、版と「更新して再起動」を出す', () => {
      const html = panel({ appInfo, update: { phase: 'available', version: '0.2.0' } })
      expect(html).toContain('v0.2.0があります')
      expect(html).toContain('更新して再起動')
      expect(html).not.toContain('更新を確認')
    })

    it('確かめているあいだと入れているあいだは、確認のボタンを押せない', () => {
      for (const update of [
        { phase: 'checking' },
        { phase: 'applying', version: '0.2.0' }
      ] as const) {
        expect(panel({ appInfo, update })).toMatch(/<button[^>]*disabled=""[^>]*>更新を確認/)
      }
      expect(panel({ appInfo, update: { phase: 'latest' } })).toContain('最新の版です')
      expect(panel({ appInfo, update: { phase: 'latest' } })).not.toMatch(
        /disabled=""[^>]*>更新を確認/
      )
    })

    it('入れられなかったら、もう一度「更新して再起動」を押せる', () => {
      const html = panel({ appInfo, update: { phase: 'applyFailed', version: '0.2.0' } })
      expect(html).toContain('更新を入れられませんでした')
      expect(html).toContain('更新して再起動')
    })
  })

  it('Rustから来た更新の状態を、画面の状態に読み替える', () => {
    expect(toAppUpdate({ kind: 'unsupported' })).toEqual({ phase: 'unsupported' })
    expect(toAppUpdate({ kind: 'latest', current: '0.1.0' })).toEqual({ phase: 'latest' })
    expect(toAppUpdate({ kind: 'available', current: '0.1.0', version: '0.2.0' })).toEqual({
      phase: 'available',
      version: '0.2.0'
    })
  })

  it('中身のあるレイヤーに名前の欄を出し、行き方を薄く添える', () => {
    const html = panel()
    expect(html).toContain('aria-label="L0の名前"')
    expect(html).toContain('aria-label="L2の名前"')
    expect(html).toMatch(/placeholder="Space長押し"[^>]*value="記号"/)
  })

  it('繋いでいなければ名前の欄の代わりに案内を出す', () => {
    const html = panel({ layers: [], onRename: undefined })
    expect(html).not.toContain('の名前"')
    expect(html).toContain('キーボードに接続すると付けられます')
  })

  it('オーバーレイの設定は、いまの値で出す', () => {
    const html = panel()
    expect(html).toContain('value="60"')
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/)
  })

  it('長押しの判定時間をmsで出す', () => {
    const html = panel()
    expect(html).toMatch(/type="range" min="100" max="500" step="10"[^>]*value="250"/)
    expect(html).toContain('>250ms<')
  })

  it('許可したキーボードを並べ、保存できるときだけ「忘れる」を出す', () => {
    expect(panel()).toContain('Cornix LP')
    expect(panel()).toContain('e118:0001')
    expect(panel()).not.toContain('>忘れる<')
    expect(panel({ onForgetDevice: noop })).toContain('>忘れる<')
    expect(panel({ settings: { ...panelSettings, grantedDevices: [] } })).toContain(
      'まだありません'
    )
  })

  it('後ろのぼかしは、使えないOSでは押せなくしてそう書く', () => {
    expect(panel()).toMatch(/type="checkbox"[^>]*disabled=""/)
    expect(panel()).toContain('Windows 11でだけ使えます')
    expect(panel({ blurSupported: true })).toContain('強さはOSが決めます')
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
  const finder = (routes: Map<string, ReturnType<typeof route>[]>) =>
    renderToStaticMarkup(
      <SymbolFinder
        routes={routes}
        stepsOf={(r) =>
          routeSteps(
            r,
            r.layer === 2 ? 'W' : r.shift ? '2' : ',',
            r.layer === 2 ? 'Space長押し' : null
          )
        }
        onPick={noop}
      />
    )

  it('記号ごとに1枚のカードにし、記号と押すキーの組み合わせを対で出す', () => {
    const html = finder(new Map([['@', [route(2)]]]))
    // 読み上げでも「@ はSpace長押し+ W」と分かる
    expect(html).toContain('aria-label="@: Space長押し + W"')
    // レイヤーは番号ではなく行き方で言う
    expect(html).toMatch(/background-color:var\(--color-layer-2\)">Space長押し</)
    expect(html).toMatch(/>W<\/span>/)
  })

  it('2番目の打ち方を「または」で小さく添える', () => {
    const html = finder(new Map([['"', [route(2), route(0, true)]]]))
    expect(html).toContain('または')
    expect(html).toContain('>Shift<')
    expect(html).toContain('title="Space長押し + W、またはShift + 2"')
  })

  it('出せない記号のカードは押せなくし、そう書く', () => {
    const html = finder(new Map([['¥', []]]))
    expect(html).toMatch(/disabled=""[^>]*aria-label="¥: このキーマップでは出せません"/)
  })

  it('タップと長押しを兼ねるキーは「タップ」と添える', () => {
    expect(routeSteps(route(0, false, true), '`', null)).toEqual([{ kind: 'key', text: '`タップ' }])
  })
})
