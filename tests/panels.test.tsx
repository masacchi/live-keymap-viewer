/** ツールバーや案内など、キーボード図以外の部品を静的に描いて確かめる。 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LayerStrip } from '@/components/LayerStrip'
import { LoadingPanel } from '@/components/LoadingPanel'
import { OverlayControls, overlayFaded } from '@/components/OverlayControls'

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

describe('LayerStrip', () => {
  const strip = (preview: number | null) =>
    renderToStaticMarkup(
      <LayerStrip
        count={10}
        activeLayers={[0, 2]}
        shownLayer={preview ?? 2}
        preview={preview}
        onPreview={() => undefined}
      />
    )

  it('レイヤーの数だけ並べ、有効なレイヤーはその色で塗る', () => {
    const html = strip(null)
    expect(html.match(/<button/g)).toHaveLength(10)
    expect(html).toContain('background-color:var(--layer-2)')
    expect(html).toContain('background-color:var(--layer-0)')
    expect(html).not.toContain('background-color:var(--layer-1)')
    expect(html).not.toContain('プレビュー中')
  })

  it('プレビュー中は、そう書いて戻るボタンを出す', () => {
    const html = strip(5)
    expect(html).toContain('L5 をプレビュー中')
    expect(html).toContain('>戻る<')
  })
})

describe('LayerStrip: 名前', () => {
  it('名前があれば番号の横に出す', () => {
    const html = renderToStaticMarkup(
      <LayerStrip
        count={3}
        activeLayers={[0]}
        shownLayer={0}
        preview={null}
        names={['基本', '', '記号']}
        onPreview={() => undefined}
        onRename={() => undefined}
      />
    )
    expect(html).toContain('L0<span class="ml-1 font-medium">基本</span>')
    expect(html).toContain('L2<span class="ml-1 font-medium">記号</span>')
    expect(html).toContain('ダブルクリックで名前を付ける')
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
