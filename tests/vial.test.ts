import { describe, expect, it } from 'vitest'
import {
  CMD_VIA_VIAL_PREFIX,
  CMD_VIAL_DYNAMIC_ENTRY_OP,
  DYNAMIC_VIAL_TAP_DANCE_GET
} from '@/hid/constants'
import { MockTransport } from '@/hid/mockTransport'
import { RequestQueue, WebHidTransport } from '@/hid/transport'
import {
  countEncoders,
  decodeMatrixState,
  getKeymap,
  getMatrixState,
  getTapDance,
  getUnlockStatus,
  getViaProtocol,
  isMatrixTestSupported,
  loadKeyboard,
  nextUnlockAction,
  ProtocolError,
  reloadKeymap,
  tapDanceToRead,
  unlockPoll,
  unlockStart
} from '@/hid/vial'
import { decodeKeycode, formatKeycode } from '@/keycodes/decode'
import {
  MOCK_COLS,
  MOCK_KEYMAP,
  MOCK_LAYERS,
  MOCK_ROWS,
  MOCK_TAP_DANCE
} from '@/mock/cornix.generated'

async function openMock(unlocked = true): Promise<MockTransport> {
  const transport = new MockTransport({ unlocked })
  await transport.open()
  return transport
}

describe('プロトコルの読み出し', () => {
  it('VIA / Vial のバージョンを読む', async () => {
    const transport = await openMock()
    expect(await getViaProtocol(transport)).toBe(9)
  })

  it('定義を XZ 展開して JSON にする', async () => {
    const transport = await openMock()
    const snapshot = await loadKeyboard(transport)
    expect(snapshot.definition.matrix).toEqual({ rows: 8, cols: 7 })
    expect(snapshot.definition.customKeycodes?.[0]?.name).toBe('BT0')
    expect(snapshot.definition.layouts.keymap.length).toBeGreaterThan(0)
  })

  it('キーマップを big-endian u16 として読み、.vil の内容と一致する', async () => {
    const transport = await openMock()
    const keymap = await getKeymap(transport, MOCK_LAYERS, MOCK_ROWS, MOCK_COLS)
    expect(keymap).toHaveLength(MOCK_LAYERS)
    for (let layer = 0; layer < MOCK_LAYERS; layer++) {
      for (let row = 0; row < MOCK_ROWS; row++) {
        for (let col = 0; col < MOCK_COLS; col++) {
          const expected = MOCK_KEYMAP[layer * MOCK_ROWS * MOCK_COLS + row * MOCK_COLS + col]
          expect(keymap[layer][row][col]).toBe(expected)
        }
      }
    }
  })

  it('読んだキーマップが Vial の文字列表記に戻る', async () => {
    const transport = await openMock()
    const keymap = await getKeymap(transport, MOCK_LAYERS, MOCK_ROWS, MOCK_COLS)
    expect(formatKeycode(decodeKeycode(keymap[0][7][5]))).toBe('LT2(KC_SPACE)')
    expect(formatKeycode(decodeKeycode(keymap[0][3][5]))).toBe('LT1(KC_BSPACE)')
    expect(formatKeycode(decodeKeycode(keymap[0][7][0]))).toBe('TD(3)')
    expect(formatKeycode(decodeKeycode(keymap[4][1][0]))).toBe('USER00')
  })

  it('Tap Dance を u16 LE ×5 として読む', async () => {
    const transport = await openMock()
    const entry = await getTapDance(transport, 3)
    expect(entry.onTap).toBe(MOCK_TAP_DANCE[3][0])
    expect(formatKeycode(decodeKeycode(entry.onHold))).toBe('MO(4)')
    expect(entry.tappingTerm).toBe(200)
  })

  it('エンコーダーの数を定義から数える', async () => {
    const transport = await openMock()
    const snapshot = await loadKeyboard(transport)
    expect(countEncoders(snapshot.definition)).toBe(2)
    expect(snapshot.encoders).toHaveLength(MOCK_LAYERS)
    expect(formatKeycode(decodeKeycode(snapshot.encoders[0][0][0]))).toBe('KC_VOLD')
  })

  it('loadKeyboard が一通り揃えて返す', async () => {
    const transport = await openMock()
    const snapshot = await loadKeyboard(transport)
    expect(snapshot).toMatchObject({
      viaProtocol: 9,
      vialProtocol: 6,
      layers: 10,
      rows: 8,
      cols: 7,
      matrixTestSupported: true
    })
    expect(snapshot.tapDance).toHaveLength(MOCK_TAP_DANCE.length)
    expect(snapshot.uid).toBe('16882930253541522617')
  })
})

describe('Tap Dance は要る枠だけ読む', () => {
  const tapDanceReads = (transport: MockTransport): number[] =>
    transport.requests
      .filter(
        (r) =>
          r[0] === CMD_VIA_VIAL_PREFIX &&
          r[1] === CMD_VIAL_DYNAMIC_ENTRY_OP &&
          r[2] === DYNAMIC_VIAL_TAP_DANCE_GET
      )
      .map((r) => r[3])

  it('キーマップとノブで使っている枠と、先頭の 5 個だけ読む', async () => {
    const transport = await openMock()
    const snapshot = await loadKeyboard(transport)
    // Cornix のキーマップが使っているのは TD(3) だけで、先頭 5 個に含まれる
    expect(tapDanceReads(transport)).toEqual([0, 1, 2, 3, 4])
    expect(snapshot.tapDance).toHaveLength(MOCK_TAP_DANCE.length) // 枠の数は保つ
    expect(snapshot.tapDance[3]?.onHold).toBe(0x5224) // 長押しで MO(4)
    expect(snapshot.tapDance[5]).toBeUndefined()
  })

  it('先頭 5 個より後ろでも、キーマップで使っていれば読む', async () => {
    const transport = await openMock()
    transport.setKeycode(1, 0, 1, 0x5700 + 20) // L1 に TD(20)
    const snapshot = await loadKeyboard(transport)
    expect(tapDanceReads(transport)).toEqual([0, 1, 2, 3, 4, 20])
    expect(snapshot.tapDance[20]).toBeDefined()
  })

  it('読み直しでは、新しく使われた枠も読む', async () => {
    const transport = await openMock()
    const before = await loadKeyboard(transport)
    transport.setKeycode(0, 0, 1, 0x5700 + 20)
    const after = await reloadKeymap(transport, before)
    expect(before.tapDance[20]).toBeUndefined()
    expect(after.tapDance[20]).toBeDefined()
  })

  it('ノブに割り当てた TD も数え、枠の数を超える番号は無視する', () => {
    const keymap = [[[0x5700 + 9, 0x5700 + 40]]]
    const encoders = [[[0x5700 + 12, 0x0004]]]
    expect(tapDanceToRead(32, keymap, encoders)).toEqual([0, 1, 2, 3, 4, 9, 12])
    expect(tapDanceToRead(3, [[[0x0004]]], [])).toEqual([0, 1, 2])
  })
})

describe('matrix state', () => {
  it('行ごとに MSB バイトが先に来る並びをほどく', () => {
    // 3 行 × 10 列。row_size = 2、col 8 は先頭バイトの bit0 に入る
    const data = new Uint8Array(32)
    data[2] = 0b0000_0001 // row0 の上位バイト → col 8
    data[3] = 0b0000_0010 // row0 の下位バイト → col 1
    data[4] = 0b0000_0000
    data[5] = 0b1000_0000 // row1 → col 7
    const matrix = decodeMatrixState(data, 3, 10)
    expect(matrix[0][8]).toBe(true)
    expect(matrix[0][1]).toBe(true)
    expect(matrix[0][0]).toBe(false)
    expect(matrix[1][7]).toBe(true)
    expect(matrix[2].every((v) => !v)).toBe(true)
  })

  it('押したキーが matrix に出る', async () => {
    const transport = await openMock()
    transport.press(7, 5)
    transport.press(0, 1)
    const matrix = await getMatrixState(transport, MOCK_ROWS, MOCK_COLS)
    expect(matrix[7][5]).toBe(true)
    expect(matrix[0][1]).toBe(true)
    expect(matrix[0][0]).toBe(false)

    transport.release(0, 1)
    const after = await getMatrixState(transport, MOCK_ROWS, MOCK_COLS)
    expect(after[0][1]).toBe(false)
    expect(after[7][5]).toBe(true)
  })

  it('ロック中は matrix が取れない', async () => {
    const transport = await openMock(false)
    transport.press(7, 5)
    const matrix = await getMatrixState(transport, MOCK_ROWS, MOCK_COLS)
    expect(matrix.flat().some((v) => v)).toBe(false)
  })

  it('Cornix のサイズなら matrix tester の条件を満たす', () => {
    expect(isMatrixTestSupported(6, 8, 7)).toBe(true)
    // vial protocol 2 以下は不可
    expect(isMatrixTestSupported(2, 8, 7)).toBe(false)
    // (cols/8 + 1) * rows が 28 を超えると不可
    expect(isMatrixTestSupported(6, 20, 20)).toBe(false)
  })
})

describe('アンロック', () => {
  it('ロック中は押すべきキーを教える', async () => {
    const transport = await openMock(false)
    const status = await getUnlockStatus(transport)
    expect(status.unlocked).toBe(false)
    expect(status.keys).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 }
    ])
  })

  it('unlock キーを押し続けるとカウンタが減ってアンロックされる', async () => {
    const transport = await openMock(false)
    await unlockStart(transport)
    transport.press(0, 0)
    transport.press(0, 1)

    let progress = await unlockPoll(transport)
    expect(progress.inProgress).toBe(true)
    expect(progress.counter).toBeLessThan(50)

    for (let i = 0; i < 60 && !progress.unlocked; i++) {
      progress = await unlockPoll(transport)
    }
    expect(progress.unlocked).toBe(true)
    expect(progress.inProgress).toBe(false)
  })

  it('途中で離すとカウンタが戻る', async () => {
    const transport = await openMock(false)
    await unlockStart(transport)
    transport.press(0, 0)
    transport.press(0, 1)
    await unlockPoll(transport)
    await unlockPoll(transport)
    transport.release(0, 1)
    const progress = await unlockPoll(transport)
    expect(progress.counter).toBe(50)
    expect(progress.unlocked).toBe(false)
  })

  it('開始していなければ、やり直すべきだと判断する', async () => {
    const transport = await openMock(false)
    // unlock_start を呼ばずにポーリングすると in_progress は落ちたまま
    const progress = await unlockPoll(transport)
    expect(progress).toMatchObject({ unlocked: false, inProgress: false })
    expect(nextUnlockAction(progress)).toBe('restart')
  })

  it('進行中はただ待つ、アンロックできたら終わり', async () => {
    const transport = await openMock(false)
    await unlockStart(transport)
    transport.press(0, 0)
    transport.press(0, 1)

    let progress = await unlockPoll(transport)
    expect(nextUnlockAction(progress)).toBe('wait')

    for (let i = 0; i < 60 && !progress.unlocked; i++) {
      progress = await unlockPoll(transport)
    }
    expect(nextUnlockAction(progress)).toBe('done')
  })

  it('アンロック進行中は VIA コマンドが通らない', async () => {
    const transport = await openMock(false)
    await unlockStart(transport)
    // ファームは書き換えずに返すので、レイヤー数の位置にはリクエストのバイトが残る
    const data = await transport.send(new Uint8Array([0x11]))
    expect(data[1]).toBe(0)
  })
})

describe('RequestQueue', () => {
  it('リクエストを 1 本に直列化する', async () => {
    const queue = new RequestQueue()
    const order: string[] = []
    const slow = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push('slow')
    })
    const fast = queue.run(async () => {
      order.push('fast')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['slow', 'fast'])
  })

  it('途中の失敗でキューが止まらない', async () => {
    const queue = new RequestQueue()
    const failed = queue.run(async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok')
  })
})

describe('対応バージョンの確認', () => {
  it('v6 以外はエラーにする', async () => {
    const transport = await openMock()
    // Vial プロトコルの応答だけを 5 に差し替える
    const original = transport.send.bind(transport)
    transport.send = async (request, options) => {
      const data = await original(request, options)
      if (request[0] === 0xfe && request[1] === 0x00) data[0] = 5
      return data
    }
    await expect(loadKeyboard(transport)).rejects.toBeInstanceOf(ProtocolError)
  })
})

describe('キーマップの読み直し', () => {
  it('Vial 側で書き換えられたキーマップを拾い直す', async () => {
    const transport = await openMock()
    const before = await loadKeyboard(transport)
    expect(formatKeycode(decodeKeycode(before.keymap[0][0][1]))).toBe('KC_Q')

    // Vial でベースレイヤーの Q を Z に変えた、という想定
    transport.setKeycode(0, 0, 1, 0x001d) // KC_Z
    const after = await reloadKeymap(transport, before)

    expect(formatKeycode(decodeKeycode(after.keymap[0][0][1]))).toBe('KC_Z')
    // 触っていないところは変わらない
    expect(formatKeycode(decodeKeycode(after.keymap[0][7][5]))).toBe('LT2(KC_SPACE)')
  })

  it('定義は読み直さない(焼き直さない限り変わらないので)', async () => {
    const transport = await openMock()
    const before = await loadKeyboard(transport)
    const countBefore = transport.requests.filter(
      (r) => r[0] === 0xfe && r[1] === 0x02 // CMD_VIAL_GET_DEFINITION
    ).length
    expect(countBefore).toBeGreaterThan(0)

    const after = await reloadKeymap(transport, before)
    const countAfter = transport.requests.filter((r) => r[0] === 0xfe && r[1] === 0x02).length

    expect(countAfter).toBe(countBefore) // 追加で読んでいない
    expect(after.definition).toBe(before.definition) // 同じものを使い回している
  })

  it('Tap Dance とエンコーダーも読み直す', async () => {
    const transport = await openMock()
    const before = await loadKeyboard(transport)
    const after = await reloadKeymap(transport, before)
    expect(after.tapDance).toHaveLength(before.tapDance.length)
    expect(after.encoders).toEqual(before.encoders)
  })
})

/**
 * raw HID の入力レポートは、その HID を開いているすべてのプロセスに配られる。
 * Vial を同時に開いていると相手宛ての応答も届くので、照合して捨てられること。
 */
describe('他アプリ宛ての応答を弾く', () => {
  class FakeHidDevice extends EventTarget {
    opened = false
    productName = 'Fake Vial'
    collections = [{ usagePage: 0xff60, usage: 0x61 }]
    /** sendReport のたびに、この関数が返すパケットを順に流す。 */
    responder: (request: Uint8Array) => Uint8Array[] = () => []

    async open(): Promise<void> {
      this.opened = true
    }
    async close(): Promise<void> {
      this.opened = false
    }
    async sendReport(_reportId: number, data: BufferSource): Promise<void> {
      const request = new Uint8Array(data as ArrayBuffer)
      for (const packet of this.responder(request)) {
        const event = new Event('inputreport')
        Object.defineProperty(event, 'data', { value: new DataView(packet.buffer) })
        this.dispatchEvent(event)
      }
    }
  }

  function packet(...bytes: number[]): Uint8Array {
    const out = new Uint8Array(32)
    out.set(bytes)
    return out
  }

  it('コマンド ID が合わないパケットは捨てて、本来の応答を待つ', async () => {
    const device = new FakeHidDevice()
    // 先に他アプリ宛て(0x11 レイヤー数)が届き、そのあと本命(0x02 0x03)が来る
    device.responder = () => [packet(0x11, 0x0a), packet(0x02, 0x03, 0b0000_0010)]
    const transport = new WebHidTransport(device as unknown as HIDDevice)
    await transport.open()

    const matrix = await getMatrixState(transport, 1, 7)
    expect(matrix[0][1]).toBe(true)
    expect(matrix[0][0]).toBe(false)
  })

  it('keymap バッファはオフセットとサイズまで照合する', async () => {
    const device = new FakeHidDevice()
    device.responder = (request) => [
      // 同じ 0x12 でも別のオフセットへの応答は受け取らない
      packet(0x12, 0xff, 0xff, request[3], 0xde, 0xad),
      packet(0x12, request[1], request[2], request[3], 0x00, 0x2b)
    ]
    const transport = new WebHidTransport(device as unknown as HIDDevice)
    await transport.open()

    const keymap = await getKeymap(transport, 1, 1, 1)
    expect(formatKeycode(decodeKeycode(keymap[0][0][0]))).toBe('KC_TAB') // 0x002b
  })

  it('照合が通らないまま時間切れになれば例外にする', async () => {
    const device = new FakeHidDevice()
    device.responder = () => [packet(0x11, 0x0a)] // ずっと他アプリ宛てだけ
    const transport = new WebHidTransport(device as unknown as HIDDevice)
    await transport.open()

    await expect(getMatrixState(transport, 1, 7)).rejects.toThrow()
  }, 10000)
})
