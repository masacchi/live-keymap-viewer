import { describe, expect, it } from 'vitest'
import { MockTransport } from '@/hid/mockTransport'
import { decodeKeycode, formatKeycode } from '@/keycodes/decode'
import { KeyboardSession, type SessionOptions, type SessionState } from '@/session/keyboardSession'

/** ループが毎回イベントループに制御を返すようにする(でないとテスト側が進めない)。 */
const yieldSleep = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function options(): SessionOptions & { clock: { t: number } } {
  const clock = { t: 0 }
  return { clock, now: () => clock.t, sleep: yieldSleep }
}

/** 状態が条件を満たすまで待つ。 */
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

/** 状態通知に依らず、条件が真になるまで待つ。 */
async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('待ちきれなかった')
    await new Promise((r) => setTimeout(r, 1))
  }
}

const isUnlockStart = (r: Uint8Array): boolean => r[0] === 0xfe && r[1] === 0x06

async function readySession(mock = new MockTransport({ unlocked: true })) {
  const session = new KeyboardSession(mock, options())
  await session.start()
  await waitFor(session, (s) => s.status === 'ready')
  return { session, mock }
}

describe('KeyboardSession: 接続と読み込み', () => {
  it('アンロック済みなら読み込んでそのままポーリングに入る', async () => {
    const { session } = await readySession()
    const state = session.state
    expect(state.snapshot?.layers).toBe(10)
    expect(state.geometry?.keys).toHaveLength(50)
    expect(state.engine).not.toBeNull()
    expect(state.deviceLabel).toBe('Cornix LP (モック)')
    await session.dispose()
  })

  it('状態の遷移を connecting → loading → ready の順で通知する', async () => {
    const mock = new MockTransport({ unlocked: true })
    const session = new KeyboardSession(mock, options())
    const seen: string[] = []
    session.subscribe((s) => {
      if (seen[seen.length - 1] !== s.status) seen.push(s.status)
    })
    await session.start()
    await waitFor(session, (s) => s.status === 'ready')
    expect(seen).toEqual(['connecting', 'loading', 'ready'])
    await session.dispose()
  })

  it('start() は 1 回しか呼べない', async () => {
    const { session } = await readySession()
    await expect(session.start()).rejects.toThrow()
    await session.dispose()
  })
})

describe('KeyboardSession: アンロック', () => {
  it('ロックを見つけたら、ボタンを待たずにアンロック手順を始める', async () => {
    const mock = new MockTransport({ unlocked: false })
    const session = new KeyboardSession(mock, options())
    await session.start()
    const state = await waitFor(session, (s) => s.status === 'unlocking')
    expect(state.unlock?.keys).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 }
    ])
    // unlock_start が実際に送られている
    expect(mock.requests.some((r) => r[0] === 0xfe && r[1] === 0x06)).toBe(true)
    await session.dispose()
  })

  it('指定のキーを押し続けるとアンロックされ、ポーリングに移る', async () => {
    const mock = new MockTransport({ unlocked: false })
    const session = new KeyboardSession(mock, options())
    await session.start()
    await waitFor(session, (s) => s.status === 'unlocking')

    mock.press(0, 0)
    mock.press(0, 1)
    const state = await waitFor(session, (s) => s.status === 'ready')
    expect(state.unlock).toBeNull()
    await session.dispose()
  })

  it('進み具合をカウンタで通知する', async () => {
    const mock = new MockTransport({ unlocked: false })
    const session = new KeyboardSession(mock, options())
    await session.start()
    await waitFor(session, (s) => s.status === 'unlocking')
    mock.press(0, 0)
    mock.press(0, 1)
    const state = await waitFor(session, (s) => (s.unlock?.counter ?? 50) < 40)
    expect(state.unlock?.max).toBe(50)
    await session.dispose()
  })

  it('手順が外から打ち切られたら、自分でやり直す', async () => {
    const mock = new MockTransport({ unlocked: false })
    const session = new KeyboardSession(mock, options())
    await session.start()
    await waitFor(session, (s) => s.status === 'unlocking')
    const startsBefore = mock.requests.filter(isUnlockStart).length

    mock.abortUnlock() // 挿し直しや vial_lock の代わり
    await until(() => mock.requests.filter(isUnlockStart).length > startsBefore)

    // やり直したあとも、押し続ければアンロックできる
    mock.press(0, 0)
    mock.press(0, 1)
    await waitFor(session, (s) => s.status === 'ready')
    await session.dispose()
  })

  it('アンロック中は読み直しを受け付けない(VIA コマンドが通らないため)', async () => {
    const mock = new MockTransport({ unlocked: false })
    const session = new KeyboardSession(mock, options())
    await session.start()
    await waitFor(session, (s) => s.status === 'unlocking')
    const before = mock.requests.length
    await session.reload()
    // keymap バッファ(0x12)は読みに行っていない
    expect(mock.requests.slice(before).some((r) => r[0] === 0x12)).toBe(false)
    await session.dispose()
  })
})

describe('KeyboardSession: ポーリング', () => {
  it('押したキーが layers に出る', async () => {
    const { session, mock } = await readySession()
    mock.press(0, 1) // Q
    const state = await waitFor(session, (s) => s.layers?.held.has('0,1') === true)
    expect(formatKeycode(state.layers!.held.get('0,1')!.keycode)).toBe('KC_Q')
    await session.dispose()
  })

  it('画面が変わらないポーリングでは通知しない', async () => {
    const { session } = await readySession()
    let notified = 0
    session.subscribe(() => notified++)
    const afterSubscribe = notified // subscribe 直後の 1 回
    await new Promise((r) => setTimeout(r, 50)) // 何度もポーリングさせる
    expect(notified).toBe(afterSubscribe)
    await session.dispose()
  })

  it('通信が失敗したら error にして止まる', async () => {
    const { session, mock } = await readySession()
    const original = mock.send.bind(mock)
    mock.send = async (request, opts) => {
      if (request[0] === 0x02) throw new Error('ケーブルが抜けた')
      return original(request, opts)
    }
    const state = await waitFor(session, (s) => s.status === 'error')
    expect(state.error).toBe('ケーブルが抜けた')

    // 止まっている: 以後 matrix を読みに行かない
    const before = mock.requests.length
    await new Promise((r) => setTimeout(r, 30))
    expect(mock.requests.length).toBe(before)
    await session.dispose()
  })
})

describe('KeyboardSession: 読み直し', () => {
  it('Vial で変えたキーマップを拾い、ポーリングを続ける', async () => {
    const { session, mock } = await readySession()
    const geometryBefore = session.state.geometry

    mock.setKeycode(0, 0, 1, 0x001d) // Q → Z
    await session.reload()
    const state = session.state
    expect(state.reloading).toBe(false)
    expect(state.status).toBe('ready')
    expect(formatKeycode(decodeKeycode(state.snapshot!.keymap[0][0][1]))).toBe('KC_Z')
    // 物理配置は作り直さない(描画が跳ねない)
    expect(state.geometry).toBe(geometryBefore)

    // ポーリングが再開している
    mock.press(0, 1)
    const pressed = await waitFor(session, (s) => s.layers?.held.has('0,1') === true)
    expect(formatKeycode(pressed.layers!.held.get('0,1')!.keycode)).toBe('KC_Z')
    await session.dispose()
  })

  it('読み直しを重ねて呼んでも、実際に読むのは 1 回だけ', async () => {
    const { session, mock } = await readySession()
    const before = mock.requests.filter((r) => r[0] === 0x12).length
    await Promise.all([session.reload(), session.reload(), session.reload()])
    // 10 レイヤー × 8 × 7 × 2 バイト = 1120 バイト。28 バイトずつなので 40 回で 1 周
    expect(mock.requests.filter((r) => r[0] === 0x12).length - before).toBe(40)
    await session.dispose()
  })

  it('読み直しのあとも、matrix の要求が重なって飛ぶことはない(ループは常に 1 本)', async () => {
    const mock = new MockTransport({ unlocked: true, latencyMs: 3 })
    const session = new KeyboardSession(mock, options())
    await session.start()
    await waitFor(session, (s) => s.status === 'ready', 5000)

    let inFlight = 0
    let maxInFlight = 0
    const original = mock.send.bind(mock)
    mock.send = async (request, opts) => {
      if (request[0] !== 0x02) return original(request, opts)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        return await original(request, opts)
      } finally {
        inFlight--
      }
    }

    await session.reload()
    await session.reload()
    await new Promise((r) => setTimeout(r, 60))
    expect(maxInFlight).toBe(1)
    await session.dispose()
  })
})

describe('KeyboardSession: 破棄', () => {
  it('破棄したら transport を閉じ、以後は通知しない', async () => {
    const { session, mock } = await readySession()
    let notified = 0
    session.subscribe(() => notified++)
    const afterSubscribe = notified

    await session.dispose()
    expect(mock.opened).toBe(false)
    expect(session.isDisposed).toBe(true)

    mock.press(0, 1)
    await new Promise((r) => setTimeout(r, 30))
    expect(notified).toBe(afterSubscribe)
  })

  it('応答待ちの途中で破棄しても、戻ってきた応答で状態を書き換えない', async () => {
    // 1 往復 15ms かかるデバイス。破棄の時点で matrix の要求が飛んでいる
    const mock = new MockTransport({ unlocked: true, latencyMs: 15 })
    const session = new KeyboardSession(mock, options())
    await session.start()
    await waitFor(session, (s) => s.status === 'ready', 5000)

    mock.press(0, 1)
    const frozen = session.state
    await session.dispose()
    await new Promise((r) => setTimeout(r, 60))
    expect(session.state).toBe(frozen) // 同じオブジェクトのまま
    expect(session.state.status).toBe('ready') // error にもならない
  })

  it('二重に破棄しても安全', async () => {
    const { session } = await readySession()
    await session.dispose()
    await expect(session.dispose()).resolves.toBeUndefined()
  })
})
