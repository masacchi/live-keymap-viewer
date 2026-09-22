/** ツールバーや案内など、キーボード図以外の部品を静的に描いて確かめる。 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { describeTrigger, LayerStrip } from '@/components/LayerStrip'
import { LoadingPanel } from '@/components/LoadingPanel'
import { OverlayControls, overlayFaded } from '@/components/OverlayControls'
import { PreviewNotice } from '@/components/PreviewNotice'
import { Button } from '@/components/ui/Button'
import type { LayerSummary, LayerTrigger } from '@/engine/layerSummary'
import { decodeKeycode, QK_LAYER_TAP, QK_MOMENTARY, QK_TOGGLE_LAYER } from '@/keycodes/decode'

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

  it('操作パネルに切り替えのチェックボックスを出す', () => {
    const html = renderToStaticMarkup(
      <OverlayControls
        displayLayer={0}
        opacity={0.8}
        onOpacity={() => undefined}
        autoFade={true}
        onAutoFade={() => undefined}
        onExit={() => undefined}
      />
    )
    expect(html).toContain('L0 で薄く')
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
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
