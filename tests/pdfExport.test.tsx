/** PDFの書き出し: 添付するキーマップ・メタデータ・印刷用の1枚。 */
import type { JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { PrintSheet } from '@/components/PrintSheet'
import { MockTransport } from '@/hid/mockTransport'
import { type KeyboardSnapshot, loadKeyboard } from '@/hid/vial'
import { useKeymapGuide } from '@/hooks/useKeymapGuide'
import { buildGeometry } from '@/layout/geometry'
import { buildKeymapExport, buildPdfExport, KEYMAP_FORMAT } from '@/lib/keymapExport'

let snapshot: KeyboardSnapshot
beforeAll(async () => {
  const transport = new MockTransport({ unlocked: true, tappingTerm: 200 })
  await transport.open()
  snapshot = await loadKeyboard(transport)
})

const input = () => ({
  snapshot,
  deviceLabel: 'Cornix LP',
  layerNames: ['基本', '', '記号'],
  labelMode: 'jis' as const,
  appVersion: '0.2.0',
  exportedAt: new Date('2026-09-27T10:00:00+09:00')
})

describe('添付するキーマップ(keymap.json)', () => {
  it('キーコードを名前と生の値の両方で持ち、どのキーボードのものかも入れる', () => {
    const exported = buildKeymapExport(input())
    expect(exported.format).toBe(KEYMAP_FORMAT)
    expect(exported.keyboard).toMatchObject({
      name: 'Cornix LP',
      definitionName: snapshot.definition.name,
      uid: snapshot.uid,
      vialProtocol: 6,
      matrix: { rows: 8, cols: 7 }
    })
    expect(exported.layers).toHaveLength(snapshot.layers)
    expect(exported.layers[0].keycodes[0][0]).toBe('KC_TAB')
    expect(exported.layers[0].raw[0][0]).toBe(snapshot.keymap[0][0][0])
    expect(exported.layers[2].name).toBe('記号')
    expect(exported.tappingTerm).toBe(200)
    // 読んだTap Danceの枠だけ、番号付きで
    expect(exported.tapDance.length).toBeGreaterThan(0)
    expect(exported.tapDance[0]).toMatchObject({ index: 0, onHold: 'MO(2)' })
  })
})

describe('PDFのメタデータ', () => {
  it('題名とファイル名はデバイス名から作り、独自の項目にキーボードの身元を入れる', () => {
    const pdf = buildPdfExport(input())
    expect(pdf.title).toBe('Cornix LP キーマップ')
    expect(pdf.fileName).toBe('Cornix LP-keymap-2026-09-27')
    expect(pdf.keywords).toContain('L2 記号')
    expect(Object.fromEntries(pdf.custom)).toMatchObject({
      KeyboardName: 'Cornix LP',
      KeyboardUID: snapshot.uid,
      VialProtocol: '6',
      LabelMode: 'jis'
    })
    // 独自の項目の名前は英数字だけ(PDFの名前として書けるもの)
    for (const [key] of pdf.custom) expect(key).toMatch(/^[A-Za-z0-9]+$/)
    expect(JSON.parse(pdf.keymapJson).keyboard.uid).toBe(snapshot.uid)
  })
})

describe('印刷用の1枚', () => {
  function Sheet({ source = snapshot }: { source?: KeyboardSnapshot }): JSX.Element {
    const guide = useKeymapGuide(source, 'jis')
    return (
      <PrintSheet
        snapshot={source}
        geometry={buildGeometry(snapshot.definition.layouts.keymap, {
          rows: snapshot.rows,
          cols: snapshot.cols
        })}
        guide={guide}
        labelMode="jis"
        names={['基本', '', '記号']}
        keyboardName="Cornix LP"
        appVersion="0.2.0"
        printedAt={new Date('2026-09-27T10:00:00+09:00')}
      />
    )
  }

  it('中身のあるレイヤーを2つずつ並べ、最後に記号の出し方を置く', () => {
    const html = renderToStaticMarkup(<Sheet />)
    const pages = html.match(/class="print-page"/g) ?? []
    // CornixはL0〜L4に中身がある(L5〜L9は空)。2つずつで3ページ、記号の表で1ページ
    expect(pages).toHaveLength(4)
    expect(html).toContain('Cornix LP キーマップ')
    expect(html).toContain('記号の出し方')
    expect(html).toContain('>L2<')
    expect(html).toContain('記号')
    expect(html).not.toContain('>L5<')
    expect(html).toContain('4/4')
    // 使っていなければ、コンボとマクロの欄は出さない
    expect(html).not.toContain('コンボ')
  })

  it('コンボとマクロを使っていれば、最後のページに並べる', () => {
    const html = renderToStaticMarkup(
      <Sheet
        source={{
          ...snapshot,
          combos: [{ index: 0, keys: [0x16, 0x07], output: 0x29 }],
          macros: [[{ kind: 'text', text: 'hello' }], []]
        }}
      />
    )
    expect(html).toContain('コンボ(同時に押す)')
    expect(html).toContain('マクロ')
    expect(html).toContain('M0: &quot;hello&quot;')
  })
})
