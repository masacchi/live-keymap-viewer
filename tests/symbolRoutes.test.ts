import { beforeAll, describe, expect, it } from 'vitest'
import { summarizeLayers } from '@/engine/layerSummary'
import { findSymbolRoutes, shiftKeysOf } from '@/engine/symbolRoutes'
import { MockTransport } from '@/hid/mockTransport'
import { type KeyboardSnapshot, loadKeyboard } from '@/hid/vial'
import { decodeKeycode } from '@/keycodes/decode'
import { type LabelMode, labelForKeycode } from '@/keycodes/labels'

let snapshot: KeyboardSnapshot

beforeAll(async () => {
  const transport = new MockTransport({ unlocked: true })
  await transport.open()
  snapshot = await loadKeyboard(transport)
})

function routes(mode: LabelMode = 'jis', reachable?: (layer: number) => boolean) {
  const summary = summarizeLayers(snapshot)
  const context = {
    customKeycodes: snapshot.definition.customKeycodes,
    tapDance: snapshot.tapDance
  }
  return findSymbolRoutes({
    keymap: snapshot.keymap,
    labelOf: (keycode) => labelForKeycode(keycode, mode, context),
    reachable: reachable ?? ((layer) => summary[layer].triggers.length > 0)
  })
}

/** ベースレイヤーでのキーの名前(経路の「Wの位置」のような言い方に使う)。 */
function baseName(route: { row: number; col: number }): string {
  return labelForKeycode(decodeKeycode(snapshot.keymap[0][route.row][route.col]), 'jis').main
}

describe('findSymbolRoutes: Cornix を JIS で', () => {
  it('ベースレイヤーの Shift 面の記号は、Shift + そのキー', () => {
    expect(routes().get('<')?.[0]).toMatchObject({ layer: 0, shift: true, cost: 1 })
    expect(baseName(routes().get('<')![0])).toBe(',')
  })

  it('@ は L2 の W の位置', () => {
    const best = routes().get('@')![0]
    expect(best).toMatchObject({ layer: 2, shift: false, cost: 1 })
    expect(baseName(best)).toBe('W')
  })

  it('手数の少ない順に並ぶ。! は L2 の Q(1 手)が先で、L1 の Shift + 1(2 手)が後', () => {
    const list = routes().get('!')!
    expect(list[0]).toMatchObject({ layer: 2, shift: false, cost: 1 })
    expect(baseName(list[0])).toBe('Q')
    expect(list).toContainEqual(expect.objectContaining({ layer: 1, shift: true, cost: 2 }))
  })

  it('タップと長押しを兼ねるキーのタップは 0.5 手で、そう印を付ける', () => {
    // 右下のTD(3)はタップで`
    expect(routes().get('`')?.[0]).toMatchObject({ layer: 0, tap: true, cost: 0.5 })
  })

  it('入れないレイヤーの文字は経路にしない', () => {
    const list = routes('jis', (layer) => layer !== 2).get('@')!
    expect(list.every((route) => route.layer !== 2)).toBe(true)
  })

  it('表記で出る文字が変わる(US では L0 の ; の Shift が :)', () => {
    expect(routes('us').get(':')?.[0]).toMatchObject({ layer: 0, shift: true })
  })
})

describe('shiftKeysOf', () => {
  it('ベースレイヤーの Shift キーの位置を返す', () => {
    expect(shiftKeysOf(snapshot.keymap)).toContainEqual({ row: 2, col: 0 })
  })
})
