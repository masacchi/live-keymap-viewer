import { beforeEach, describe, expect, it } from 'vitest'
import { LayerEngine, emptyMatrix } from '@/engine/layerState'
import { decodeKeycode, formatKeycode } from '@/keycodes/decode'
import { labelForKeycode } from '@/keycodes/labels'
import {
  MOCK_COLS,
  MOCK_KEYMAP,
  MOCK_LAYERS,
  MOCK_ROWS,
  MOCK_TAP_DANCE
} from '@/mock/cornix.generated'
import type { TapDanceEntry } from '@/hid/vial'

function mockKeymap(): number[][][] {
  const keymap: number[][][] = []
  for (let layer = 0; layer < MOCK_LAYERS; layer++) {
    const rows: number[][] = []
    for (let row = 0; row < MOCK_ROWS; row++) {
      const cols: number[] = []
      for (let col = 0; col < MOCK_COLS; col++) {
        cols.push(MOCK_KEYMAP[layer * MOCK_ROWS * MOCK_COLS + row * MOCK_COLS + col])
      }
      rows.push(cols)
    }
    keymap.push(rows)
  }
  return keymap
}

const tapDance: TapDanceEntry[] = MOCK_TAP_DANCE.map((e) => ({
  onTap: e[0],
  onHold: e[1],
  onDoubleTap: e[2],
  onTapHold: e[3],
  tappingTerm: e[4]
}))

/** Cornix の物理位置(reference/Cornix_設定_LT.vil より)。 */
const SPACE = { row: 7, col: 5 } // LT2(KC_SPACE)
const BSPACE = { row: 3, col: 5 } // LT1(KC_BSPACE)
const DELETE = { row: 3, col: 4 } // LT3(KC_DELETE)
const BACKTICK = { row: 7, col: 0 } // TD(3) → 長押しで MO(4)
const Q = { row: 0, col: 1 }

class Board {
  readonly engine: LayerEngine
  private readonly matrix = emptyMatrix(MOCK_ROWS, MOCK_COLS)
  private now = 1000

  constructor() {
    this.engine = new LayerEngine({
      layers: MOCK_LAYERS,
      rows: MOCK_ROWS,
      cols: MOCK_COLS,
      keymap: mockKeymap(),
      tapDance
    })
  }

  press(key: { row: number; col: number }): this {
    this.matrix[key.row][key.col] = true
    return this
  }

  release(key: { row: number; col: number }): this {
    this.matrix[key.row][key.col] = false
    return this
  }

  /** ポーリング 1 回分。経過時間を進めてから matrix を流し込む。 */
  tick(elapsedMs = 20) {
    this.now += elapsedMs
    return this.engine.update(this.matrix, this.now)
  }
}

describe('Layer-Tap', () => {
  let board: Board
  beforeEach(() => {
    board = new Board()
  })

  it('押し始めはまだベースレイヤー', () => {
    board.press(SPACE)
    expect(board.tick(0).displayLayer).toBe(0)
  })

  it('tapping term を超えるとレイヤーが上がる', () => {
    board.press(SPACE)
    board.tick(0)
    expect(board.tick(100).displayLayer).toBe(0)
    expect(board.tick(120).displayLayer).toBe(2) // 合計 220ms > 200ms
  })

  it('離すとベースレイヤーに戻る', () => {
    board.press(SPACE)
    board.tick(0)
    board.tick(250)
    expect(board.release(SPACE).tick().displayLayer).toBe(0)
  })

  it('tapping term 前でも、他のキーが押されたらレイヤーが上がる', () => {
    board.press(SPACE)
    board.tick(0)
    board.press(Q)
    expect(board.tick(20).displayLayer).toBe(2)
  })

  it('BS は L1、Del は L3、右下の ` は L4', () => {
    for (const [key, layer] of [
      [BSPACE, 1],
      [DELETE, 3],
      [BACKTICK, 4]
    ] as const) {
      const b = new Board()
      b.press(key)
      b.tick(0)
      expect(b.tick(250).displayLayer).toBe(layer)
    }
  })

  it('タップ(短く押して離す)ではレイヤーが上がらない', () => {
    board.press(SPACE)
    board.tick(0)
    board.tick(50)
    board.release(SPACE)
    expect(board.tick(10).displayLayer).toBe(0)
  })

  it('2 つ重ねて長押しすると、上のレイヤーが表示になる', () => {
    board.press(SPACE)
    board.tick(0)
    board.tick(250) // L2 が有効
    // L2 の (3,4) は透過なので、L0 の LT3(KC_DELETE) として解決される
    board.press(DELETE)
    board.tick(0)
    const snapshot = board.tick(250)
    expect(snapshot.activeLayers).toEqual([0, 2, 3])
    expect(snapshot.displayLayer).toBe(3)
  })

  it('同じ瞬間に押された 2 キーは、行優先の順に押したものとして扱う', () => {
    // Del(3,4) が先に解決され、それが割り込み扱いになって L3 が立つ。
    // L3 の (7,5) は KC_ACL2 なので、右親指はレイヤーキーにならない。
    board.press(SPACE).press(DELETE)
    board.tick(0)
    const snapshot = board.tick(250)
    expect(snapshot.activeLayers).toEqual([0, 3])
    expect(formatKeycode(snapshot.held.get('7,5')!.keycode)).toBe('KC_ACL2')
  })
})

describe('押した瞬間のキーコードで固定される', () => {
  it('レイヤーを上げてから押したキーは、そのレイヤーのキーコードになる', () => {
    const board = new Board()
    board.press(SPACE)
    board.tick(0)
    board.tick(250) // L2 が有効
    board.press(Q)
    const snapshot = board.tick()

    const held = snapshot.held.get(`${Q.row},${Q.col}`)
    expect(held).toBeDefined()
    expect(formatKeycode(held!.keycode)).toBe('LSFT(KC_1)') // L2 の Q は "!"
    expect(labelForKeycode(held!.keycode, 'jis').main).toBe('!')
  })

  it('レイヤーキーを先に離しても、押しっぱなしのキーは変わらない', () => {
    const board = new Board()
    board.press(SPACE)
    board.tick(0)
    board.tick(250)
    board.press(Q)
    board.tick()
    board.release(SPACE)
    const snapshot = board.tick()

    expect(snapshot.displayLayer).toBe(0)
    const held = snapshot.held.get(`${Q.row},${Q.col}`)
    expect(formatKeycode(held!.keycode)).toBe('LSFT(KC_1)')
  })

  it('ベースレイヤーで押したキーはベースのキーコードのまま', () => {
    const board = new Board()
    board.press(Q)
    board.tick()
    const held = board.tick().held.get(`${Q.row},${Q.col}`)
    expect(formatKeycode(held!.keycode)).toBe('KC_Q')
  })
})

describe('透過キーの解決', () => {
  it('表示レイヤーが透過なら下の有効レイヤーをたどる', () => {
    const board = new Board()
    board.press(BSPACE) // L1 を有効にする
    board.tick(0)
    const snapshot = board.tick(250)
    expect(snapshot.displayLayer).toBe(1)

    // L1 の (1,0) は KC_TRNS、L0 では KC_LCTRL
    const resolved = board.engine.resolveKey(1, 0, snapshot)
    expect(resolved.transparent).toBe(true)
    expect(resolved.sourceLayer).toBe(0)
    expect(formatKeycode(resolved.effective)).toBe('KC_LCTRL')
  })

  it('透過でなければそのレイヤーの値を返す', () => {
    const board = new Board()
    board.press(BSPACE)
    board.tick(0)
    const snapshot = board.tick(250)
    // L1 の (0,1) は KC_1
    const resolved = board.engine.resolveKey(0, 1, snapshot)
    expect(resolved.transparent).toBe(false)
    expect(formatKeycode(resolved.effective)).toBe('KC_1')
  })
})

/** MO / TG / TO は Cornix のキーマップに無いので、小さな合成キーマップで確かめる。 */
describe('MO / TG / TO', () => {
  const MO2 = 0x5222
  const TG1 = 0x5261
  const TO0 = 0x5200
  const TRNS = 0x0001

  function synthetic(): LayerEngine {
    // 3 レイヤー × 1 行 × 4 列
    const keymap = [
      [[MO2, TG1, TO0, 0x0004]], // L0: MO(2), TG(1), TO(0), KC_A
      [[TRNS, TRNS, TRNS, 0x0005]], // L1: ... KC_B
      [[TRNS, TRNS, TRNS, 0x0006]] // L2: ... KC_C
    ]
    return new LayerEngine({ layers: 3, rows: 1, cols: 4, keymap, tapDance: [] })
  }

  it('MO は押した瞬間から有効', () => {
    const engine = synthetic()
    const matrix = emptyMatrix(1, 4)
    matrix[0][0] = true
    expect(engine.update(matrix, 0).displayLayer).toBe(2)
    matrix[0][0] = false
    expect(engine.update(matrix, 10).displayLayer).toBe(0)
  })

  it('TG は押すたびに切り替わる', () => {
    const engine = synthetic()
    const matrix = emptyMatrix(1, 4)
    matrix[0][1] = true
    expect(engine.update(matrix, 0).displayLayer).toBe(1)
    matrix[0][1] = false
    expect(engine.update(matrix, 10).displayLayer).toBe(1) // 離しても残る
    matrix[0][1] = true
    expect(engine.update(matrix, 20).displayLayer).toBe(0) // もう一度押すと戻る
  })

  it('TO は他のレイヤーを落として切り替える', () => {
    const engine = synthetic()
    const matrix = emptyMatrix(1, 4)
    matrix[0][1] = true
    engine.update(matrix, 0) // TG(1) を有効に
    matrix[0][1] = false
    engine.update(matrix, 10)
    matrix[0][2] = true
    const snapshot = engine.update(matrix, 20) // TO(0)
    expect(snapshot.activeLayers).toEqual([0])
    expect(snapshot.toggledLayers).toEqual([])
  })

  it('MO で上がったレイヤーのキーコードが押下時に確定する', () => {
    const engine = synthetic()
    const matrix = emptyMatrix(1, 4)
    matrix[0][0] = true // MO(2)
    engine.update(matrix, 0)
    matrix[0][3] = true
    const snapshot = engine.update(matrix, 10)
    expect(formatKeycode(snapshot.held.get('0,3')!.keycode)).toBe('KC_C')
  })
})

describe('Tap Dance の長押し', () => {
  it('on_hold が MO(n) の Tap Dance は、そのエントリの tapping term を使う', () => {
    const keymap = [[[0x5703]], [[0x0001]], [[0x0001]], [[0x0001]], [[0x0001]]]
    const engine = new LayerEngine({
      layers: 5,
      rows: 1,
      cols: 1,
      keymap,
      tapDance: [
        { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 0 },
        { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 0 },
        { onTap: 0, onHold: 0, onDoubleTap: 0, onTapHold: 0, tappingTerm: 0 },
        // TD(3): 長押しで MO(4)、tapping term は 350ms
        {
          onTap: 0x0004,
          onHold: 0x5224,
          onDoubleTap: 0,
          onTapHold: 0,
          tappingTerm: 350
        }
      ]
    })
    const matrix = [[true]]
    engine.update(matrix, 0)
    expect(engine.update(matrix, 300).displayLayer).toBe(0) // 既定の 200ms では上がらない
    expect(engine.update(matrix, 360).displayLayer).toBe(4)
  })

  it('on_hold がレイヤー系でない Tap Dance はレイヤーを動かさない', () => {
    const keymap = [[[0x5700]], [[0x0001]]]
    const engine = new LayerEngine({
      layers: 2,
      rows: 1,
      cols: 1,
      keymap,
      // 長押しで Shift
      tapDance: [
        { onTap: 0x0004, onHold: 0x00e1, onDoubleTap: 0, onTapHold: 0, tappingTerm: 200 }
      ]
    })
    const matrix = [[true]]
    engine.update(matrix, 0)
    expect(engine.update(matrix, 500).displayLayer).toBe(0)
  })
})

describe('reset', () => {
  it('押下とトグルをすべて忘れる', () => {
    const board = new Board()
    board.press(SPACE)
    board.tick(0)
    board.tick(250)
    board.engine.reset()
    const snapshot = board.engine.snapshot()
    expect(snapshot.displayLayer).toBe(0)
    expect(snapshot.held.size).toBe(0)
  })
})

describe('デコードの健全性', () => {
  it('モックのキーマップに unknown なキーコードが無い', () => {
    const unknown = MOCK_KEYMAP.map(decodeKeycode).filter((kc) => kc.kind === 'unknown')
    expect(unknown).toEqual([])
  })
})
