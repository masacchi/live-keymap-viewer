/**
 * SVG の描画を、実際にマークアップへ落として確かめる。
 * ブラウザは要らないので react-dom/server で静的に描く。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { KeyboardView } from '@/components/KeyboardView'
import { LayerEngine, emptyMatrix, type LayerSnapshot } from '@/engine/layerState'
import { MockTransport } from '@/hid/mockTransport'
import { loadKeyboard, type KeyboardSnapshot } from '@/hid/vial'
import { buildGeometry, type KeyboardGeometry } from '@/layout/geometry'

let snapshot: KeyboardSnapshot
let geometry: KeyboardGeometry

beforeAll(async () => {
  const transport = new MockTransport({ unlocked: true })
  await transport.open()
  snapshot = await loadKeyboard(transport)
  geometry = buildGeometry(snapshot.definition.layouts.keymap, {
    rows: snapshot.rows,
    cols: snapshot.cols
  })
})

function newEngine(): LayerEngine {
  return new LayerEngine({
    layers: snapshot.layers,
    rows: snapshot.rows,
    cols: snapshot.cols,
    keymap: snapshot.keymap,
    tapDance: snapshot.tapDance
  })
}

function render(
  engine: LayerEngine,
  layers: LayerSnapshot,
  mode: 'jis' | 'us' = 'jis',
  unlockKeys: Array<{ row: number; col: number }> = []
): string {
  return renderToStaticMarkup(
    <KeyboardView
      geometry={geometry}
      snapshot={snapshot}
      engine={engine}
      layers={layers}
      labelMode={mode}
      unlockKeys={unlockKeys}
    />
  )
}

describe('KeyboardView', () => {
  it('定義どおりの数のキーを描く', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)
    expect(html.match(/class="key[ "]/g) ?? []).toHaveLength(geometry.keys.length)
    expect(geometry.keys).toHaveLength(50)
  })

  it('親指キーを回転して描く', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)
    // Cornix の親指は ±23 度と ±11.93 度
    expect(html).toContain('rotate(23 ')
    expect(html).toContain('rotate(-23 ')
    expect(html).toContain('rotate(11.93 ')
    expect(html).toContain('rotate(-11.93 ')
  })

  it('ベースレイヤーの JIS ラベルを出す', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)
    for (const label of ['Tab', 'Ctrl', 'Shift', 'かな', '英数', 'Enter', 'Space', '消音']) {
      expect(html).toContain(`>${label}<`)
    }
  })

  it('US モードでは US 配列の文字になる', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    expect(render(engine, layers, 'us')).toContain('>Lang1<')
    expect(render(engine, layers, 'jis')).toContain('>かな<')
  })

  it('長押しでレイヤーが出るキーに色帯を描く', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)
    expect(html).toContain('長押し→L1')
    expect(html).toContain('長押し→L2')
    expect(html).toContain('長押し→L3')
    expect(html).toContain('長押し→L4')
  })

  it('押されたキーに pressed が付く', () => {
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[0][1] = true // Q
    const layers = engine.update(matrix, 0)
    expect(render(engine, layers)).toContain('key-pressed')
  })

  it('長押し中のレイヤーキーは「押下中」になり、表示がそのレイヤーに変わる', () => {
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[7][5] = true // LT2(KC_SPACE)
    engine.update(matrix, 0)
    const layers = engine.update(matrix, 300)
    expect(layers.displayLayer).toBe(2)

    const html = render(engine, layers)
    expect(html).toContain('押下中')
    expect(html).toContain('Space 長押し')
    // L2 の (0,1) は LSFT(KC_1) → JIS では "!"
    expect(html).toContain('>!<')
    // L2 で透過のキーは薄く出す
    expect(html).toContain('key-trns')
  })

  it('アンロック対象のキーを目立たせる', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers, 'jis', [{ row: 0, col: 0 }])
    expect(html.match(/key-unlock/g) ?? []).toHaveLength(1)
  })

  it('エンコーダーを 1 個につき 1 つ描く', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)
    expect(html.match(/class="encoder"/g) ?? []).toHaveLength(2)
  })
})
