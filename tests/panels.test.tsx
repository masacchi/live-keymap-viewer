/** ツールバーや案内など、キーボード図以外の部品を静的に描いて確かめる。 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoadingPanel } from '@/components/LoadingPanel'

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
