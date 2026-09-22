/**
 * SVG の描画を、実際にマークアップへ落として確かめる。
 * ブラウザは要らないので react-dom/server で静的に描く。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { KeyboardView } from '@/components/KeyboardView'
import { emptyMatrix, LayerEngine, type LayerSnapshot } from '@/engine/layerState'
import { MockTransport } from '@/hid/mockTransport'
import { type KeyboardSnapshot, loadKeyboard } from '@/hid/vial'
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
  unlockKeys: Array<{ row: number; col: number }> = [],
  previewLayer: number | null = null,
  layerNames: string[] = []
): string {
  return renderToStaticMarkup(
    <KeyboardView
      geometry={geometry}
      snapshot={snapshot}
      engine={engine}
      layers={layers}
      labelMode={mode}
      unlockKeys={unlockKeys}
      previewLayer={previewLayer}
      layerNames={layerNames}
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
    // 帯は行き先だけ。「長押しで」はツールチップが言う
    for (const layer of [1, 2, 3, 4]) {
      expect(html).toContain(`<text class="band-text"`)
      expect(html).toMatch(new RegExp(`class="band-text"[^>]*>L${layer}</text>`))
      expect(html).toContain(`長押しで L${layer}`)
    }
  })

  it('押されたキーに pressed が付く', () => {
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[0][1] = true // Q
    const layers = engine.update(matrix, 0)
    expect(render(engine, layers)).toContain('key-pressed')
  })

  it('長押し中のレイヤーキーは出しているレイヤーを名乗り、表示がそのレイヤーに変わる', () => {
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[7][5] = true // LT2(KC_SPACE)
    engine.update(matrix, 0)
    const layers = engine.update(matrix, 300)
    expect(layers.displayLayer).toBe(2)

    const html = render(engine, layers)
    // 1u には「Space 長押し中」が収まらないので「長押し中」だけにする(キーの名前はツールチップ)
    expect(html).toContain('>長押し中<')
    expect(html).toContain('<title>Space / 長押しで L2 / raw 0x422c</title>')
    expect(html).toContain('>L2<')
    // L2 の (0,1) は LSFT(KC_1) → JIS では "!"
    expect(html).toContain('>!<')
    // L2 で透過のキーは薄く出す
    expect(html).toContain('key-trns')
  })

  it('押しているキーは、表示中のレイヤーではなく押した瞬間のキーコードで描く', () => {
    // 右下の TD(3) は長押しで L4。L4 のその位置は透過ではないので、表示中のレイヤーで
    // 引き直すと TD が見えなくなり、以前は「Lnull 長押し中」と出ていた
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[7][0] = true
    engine.update(matrix, 0)
    const layers = engine.update(matrix, 300)
    expect(layers.displayLayer).toBe(4)

    const html = render(engine, layers)
    expect(html).not.toContain('Lnull')
    expect(html).toContain('>L4<')
    expect(html).toContain('--hold:var(--color-layer-4)')
  })

  it('長いカスタムキーの名前は 2 行に割り、説明はツールチップだけに出す', () => {
    const engine = newEngine()
    const html = render(
      engine,
      engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0),
      'jis',
      [],
      4
    )
    // L4 の (0,0) は USER06 = SWITCH(shortName "Switch\nOutput")
    expect(html).toMatch(/<tspan[^>]*>Switch<\/tspan><tspan[^>]*>Output<\/tspan>/)
    // 説明(title)はキーの中に書かない。はみ出していた
    expect(html).not.toMatch(/<text[^>]*>Switch default output mode/)
    expect(html).toContain('Switch default output mode between USB/BLE')
  })

  it('レイヤーを出しているキーは、そのレイヤーの色で塗る', () => {
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[7][5] = true // LT2(KC_SPACE)
    engine.update(matrix, 0)
    const layers = engine.update(matrix, 300)

    const html = render(engine, layers)
    // 押下の黄色ではなく、レイヤー色で塗るためのクラスと変数が付く
    expect(html).toContain('key-holding')
    expect(html).toContain('--hold:var(--color-layer-2)')
    // ただの押下(レイヤーを出さないキー)には付かない
    const plain = newEngine()
    const plainMatrix = emptyMatrix(snapshot.rows, snapshot.cols)
    plainMatrix[0][1] = true // Q
    const plainHtml = render(plain, plain.update(plainMatrix, 0))
    expect(plainHtml).toContain('key-pressed')
    expect(plainHtml).not.toContain('key-holding')
  })

  it('Shift 側の文字を主文字の上に中央揃えで出す', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)
    // KC_MINUS: 主文字 "-" / Shift 側 "="。どちらも同じ x(中央)に乗る
    const main = /<text class="main" x="([\d.]+)" y="([\d.]+)" font-size="\d+">-<\/text>/.exec(html)
    const shift = /<text class="shift" x="([\d.]+)" y="([\d.]+)">=<\/text>/.exec(html)
    expect(main).not.toBeNull()
    expect(shift).not.toBeNull()
    expect(shift![1]).toBe(main![1]) // x が一致 = 中央揃え
    expect(Number(shift![2])).toBeLessThan(Number(main![2])) // Shift 側が上
  })

  it('Shift を押しているあいだは、Shift で入る文字を主文字にして目立たせる', () => {
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[2][0] = true // KC_LSHIFT
    const html = render(engine, engine.update(matrix, 0))
    expect(html).toContain('key-shifted')
    // KC_MINUS: "=" が主文字に、"-" が上の小さい方に入れ替わる
    expect(html).toMatch(/<text class="main"[^>]*>=<\/text>/)
    expect(html).toMatch(/<text class="shift"[^>]*>-<\/text>/)
    // Shift で変わらないキー(英字)はそのまま
    expect(html).toMatch(/<g class="key"[^>]*>(?:(?!<\/g>).)*>Q</)
  })

  it('Shift を押していなければ入れ替えない', () => {
    const engine = newEngine()
    const html = render(engine, engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0))
    expect(html).not.toContain('key-shifted')
    expect(html).toMatch(/<text class="main"[^>]*>-<\/text>/)
  })

  it('プレビューでは、実際の状態と関係なく指定のレイヤーを出す', () => {
    const engine = newEngine()
    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[0][0] = true // Tab を押している
    const layers = engine.update(matrix, 0)
    expect(layers.displayLayer).toBe(0)

    const html = render(engine, layers, 'jis', [], 1)
    expect(html).toContain('レイヤー 1 のキーマップ')
    // L1 の (0,1) は KC_1
    expect(html).toMatch(/<text class="main"[^>]*>1<\/text>/)
    // 透過のキーはベースの値をたどる(L1 の (1,0) は透過 → L0 の Ctrl)
    expect(html).toContain('key-trns')
    // 押しているキーの表示は実際の状態のまま
    expect(html).toContain('key-pressed')
  })

  it('レイヤーに名前があれば、長押しの色帯と長押し中のキーで名前を使う', () => {
    const engine = newEngine()
    const names = ['', '数字', '記号', 'とても長いレイヤー名']
    const idle = render(
      engine,
      engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0),
      'jis',
      [],
      null,
      names
    )
    // 帯は「L2 記号」。入らなければ名前だけ、それも入らなければ番号
    expect(idle).toContain('>L2 記号<') // Space
    expect(idle).toContain('>L1 数字<') // BS
    expect(idle).toMatch(/class="band-text"[^>]*>L3<\/text>/) // 長すぎる名前は番号に戻す
    expect(idle).toMatch(/class="band-text"[^>]*>L4<\/text>/) // 名前が無い
    expect(idle).toContain('長押しで L2 記号') // ツールチップには名前も出す

    const matrix = emptyMatrix(snapshot.rows, snapshot.cols)
    matrix[7][5] = true // LT2(KC_SPACE)
    engine.update(matrix, 0)
    const holding = render(engine, engine.update(matrix, 300), 'jis', [], null, names)
    expect(holding).toContain('>記号<')
    expect(holding).toContain('レイヤー 2(記号) のキーマップ')
  })

  it('ノブの割り当てを、そのレイヤーの内容で出す', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)
    expect(html).toContain('↺ 音量−')
    expect(html).toContain('↻ 音量+')
    // ホイールは "↑" だけだと曖昧なので補足が付く
    expect(html).toContain('↻ ↓ ホイール')
  })

  it('ノブは KLE 上の位置ではなく、キーの下に横一列でまとめる', () => {
    // Cornix の定義はエンコーダーを図の右端(x=15.25〜)に並べて置いてある。
    // そのまま描くと横に間延びするので、キーだけの幅に合わせる。
    expect(geometry.bounds.maxX).toBeCloseTo(19.75)
    expect(geometry.keyBounds.maxX).toBeCloseTo(14.5)

    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const viewBox = /viewBox="([^"]+)"/.exec(render(engine, layers))![1].split(' ').map(Number)
    // 幅はキーの範囲(+余白)で決まる。エンコーダーの置き場所に引きずられない
    expect(viewBox[2]).toBeLessThan(geometry.bounds.maxX * 58)
    expect(viewBox[2]).toBeCloseTo((geometry.keyBounds.maxX + 0.4) * 58, 0)
  })

  it('ノブの一列はキーの中央に揃え、下に置く', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = render(engine, layers)

    const circles = [...html.matchAll(/<circle class="encoder" cx="([\d.]+)" cy="([\d.]+)"/g)]
    expect(circles).toHaveLength(2)

    // 2 つとも同じ高さ = 横一列
    expect(circles[0][2]).toBe(circles[1][2])
    // キーの下端より下にある
    expect(Number(circles[0][2])).toBeGreaterThan(geometry.keyBounds.maxY * 58)

    // 左端の丸と右端の文字の中点が、キー範囲の中央に来る
    const labelXs = [...html.matchAll(/<text class="encoder-label" x="([\d.]+)"/g)].map((m) =>
      Number(m[1])
    )
    const keyCenter = ((geometry.keyBounds.minX + geometry.keyBounds.maxX) / 2) * 58
    expect(Number(circles[0][1])).toBeLessThan(keyCenter)
    expect(Math.max(...labelXs)).toBeGreaterThan(keyCenter)
  })

  it('ノブを上に置くこともできる', () => {
    const engine = newEngine()
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)
    const html = renderToStaticMarkup(
      <KeyboardView
        geometry={geometry}
        snapshot={snapshot}
        engine={engine}
        layers={layers}
        labelMode="jis"
        encoderPlacement="top"
      />
    )
    const cy = Number(/<circle class="encoder" cx="[-\d.]+" cy="([-\d.]+)"/.exec(html)![1])
    expect(cy).toBeLessThan(geometry.keyBounds.minY * 58)
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
