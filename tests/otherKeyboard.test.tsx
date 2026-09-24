/**
 * **Cornix以外のキーボードでも動くか**を、別の機種を名乗るモックで確かめる。
 *
 * このアプリは固定データを持たない(docs/ARCHITECTURE.md §1)。配置・キーマップ・レイヤー数・
 * カスタムキーコードは、すべて接続したキーボードから読む ― という前提が本当かどうかは、
 * Cornixのモックだけを相手にしていると確かめられない。ここでは
 *
 *   - 行列の大きさもレイヤー数も違う
 *   - ノブが無い
 *   - レイアウトオプション(layouts.labels)が無い
 *   - カスタムキーコードが無い
 *   - Tap Danceの枠が0
 *
 * というキーボード(tests/fixtures/boards.ts)を通し、読み込み・描画・押下・レイヤー判定まで
 * 一通り動くことを見る。対応できない条件(matrix stateが1パケットに収まらない)も併せて。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KeyboardView } from '@/components/KeyboardView'
import { MockTransport } from '@/hid/mockTransport'
import { loadKeyboard } from '@/hid/vial'
import { buildGeometry } from '@/layout/geometry'
import { KeyboardSession, type SessionState } from '@/session/keyboardSession'
import { BIG_MATRIX, PLAIN60 } from './fixtures/boards'

const yieldSleep = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function waitFor(
  session: KeyboardSession,
  predicate: (state: SessionState) => boolean,
  timeoutMs = 3000
): Promise<SessionState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`待ちきれなかった。最後の状態: ${session.state.status}`))
    }, timeoutMs)
    const unsubscribe = session.subscribe((state) => {
      if (!predicate(state)) return
      clearTimeout(timer)
      queueMicrotask(() => unsubscribe())
      resolve(state)
    })
  })
}

async function readySession(keyboard = PLAIN60) {
  const mock = new MockTransport({ keyboard, unlocked: true })
  const session = new KeyboardSession(mock, { sleep: yieldSleep })
  await session.start()
  await waitFor(session, (s) => s.status === 'ready')
  return { session, mock }
}

describe('Cornix 以外のキーボード(Plain60: 5 行 14 列・ノブ無し・カスタムキーコード無し)', () => {
  it('読み込んで、そのキーボードの大きさで図を組む', async () => {
    const { session, mock } = await readySession()
    const { snapshot, geometry } = session.state
    expect(snapshot?.rows).toBe(5)
    expect(snapshot?.cols).toBe(14)
    expect(snapshot?.layers).toBe(4)
    expect(snapshot?.definition.name).toBe('Plain60')
    expect(geometry?.keys).toHaveLength(70)
    expect(geometry?.encoders).toHaveLength(0) // ノブ無し
    expect(session.state.deviceLabel).toBe('Plain60 (モック)')
    await session.dispose()
    expect(mock.requests.length).toBeGreaterThan(0)
  })

  it('押したキーがそのまま読める', async () => {
    const { session, mock } = await readySession()
    mock.press(2, 3)
    const state = await waitFor(session, (s) => (s.layers?.held.size ?? 0) > 0)
    expect([...(state.layers?.held.keys() ?? [])]).toEqual(['2,3'])
    mock.release(2, 3)
    await waitFor(session, (s) => (s.layers?.held.size ?? 0) === 0)
    await session.dispose()
  })

  it('MO と LT でレイヤーが変わる(そのキーボードのキーマップどおりに)', async () => {
    const { session, mock } = await readySession()

    mock.press(4, 0) // MO(1)
    let state = await waitFor(session, (s) => s.layers?.displayLayer === 1)
    expect(state.layers?.activeLayers).toEqual([0, 1])
    mock.release(4, 0)
    await waitFor(session, (s) => s.layers?.displayLayer === 0)

    mock.press(4, 1) // LT(2, Space)を長押し
    state = await waitFor(session, (s) => s.layers?.displayLayer === 2, 5000)
    expect(state.layers?.activeLayers).toEqual([0, 2])
    await session.dispose()
  })

  it('レイアウトオプションもカスタムキーコードも無い定義で、ラベルまで描ける', async () => {
    const transport = new MockTransport({ keyboard: PLAIN60, unlocked: true })
    await transport.open()
    const snapshot = await loadKeyboard(transport)
    expect(snapshot.definition.layouts.labels).toBeUndefined()
    expect(snapshot.definition.customKeycodes).toBeUndefined()
    expect(snapshot.tapDance).toHaveLength(0)
    expect(snapshot.layoutOptions).toBe(0)

    const geometry = buildGeometry(snapshot.definition.layouts.keymap, {
      rows: snapshot.rows,
      cols: snapshot.cols
    })
    const engine = new (await import('@/engine/layerState')).LayerEngine({
      layers: snapshot.layers,
      rows: snapshot.rows,
      cols: snapshot.cols,
      keymap: snapshot.keymap,
      tapDance: snapshot.tapDance
    })
    const { emptyMatrix } = await import('@/engine/layerState')
    const layers = engine.update(emptyMatrix(snapshot.rows, snapshot.cols), 0)

    const html = renderToStaticMarkup(
      <KeyboardView
        geometry={geometry}
        snapshot={snapshot}
        engine={engine}
        layers={layers}
        labelMode="jis"
      />
    )
    expect(html).toContain('Esc') // (0,0)
    expect(html).toContain('MO1') // レイヤーキーは名前で出る
    expect(html).toContain('長押しで L2') // LT(2, Space)の色帯
    expect(html.match(/<g class="key"/g) ?? []).toHaveLength(70)
    await transport.close()
  })
})

describe('対応できないキーボード', () => {
  it('matrix state が 1 パケットに収まらない大きさなら、その旨を出して止まる', async () => {
    // 10行20列 →(20/8 + 1)× 10 = 30バイトで、28バイトに収まらない
    const mock = new MockTransport({ keyboard: BIG_MATRIX, unlocked: true })
    const session = new KeyboardSession(mock, { sleep: yieldSleep })
    await session.start()
    const state = await waitFor(session, (s) => s.status === 'error')
    expect(state.error).toContain('押しているキーを読み取れません')
    // 図そのものは読めているので、キーマップの確認には使える
    expect(state.geometry?.keys).toHaveLength(200)
    await session.dispose()
  })
})
