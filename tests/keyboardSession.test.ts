import { describe, expect, it } from 'vitest'
import { MockTransport } from '@/hid/mockTransport'
import { TransportError } from '@/hid/transport'
import type { CachedKeymap, VialDefinition } from '@/hid/vial'
import { decodeKeycode, formatKeycode } from '@/keycodes/decode'
import {
  KeyboardSession,
  type SessionOptions,
  type SessionState,
  STALL_LIMIT_MS
} from '@/session/keyboardSession'

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

  it('読み込みのあいだだけ進み具合を載せる', async () => {
    const mock = new MockTransport({ unlocked: true })
    const session = new KeyboardSession(mock, options())
    const stages = new Set<string>()
    session.subscribe((s) => {
      if (s.loading) stages.add(s.loading.stage)
    })
    await session.start()
    const ready = await waitFor(session, (s) => s.status === 'ready')
    expect([...stages]).toEqual(['definition', 'keymap', 'encoders', 'tapDance'])
    expect(ready.loading).toBeNull()
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

  it('単発の取りこぼしでは落とさず、応答が戻れば黙って続ける', async () => {
    // OS やファームの省電力で応答が一瞬詰まることがある。以前はこれで切断していた
    const { session, mock } = await readySession()
    const original = mock.send.bind(mock)
    let failuresLeft = 3
    mock.send = async (request, opts) => {
      if (request[0] === 0x02 && failuresLeft > 0) {
        failuresLeft--
        throw new TransportError('デバイスが応答しない(コマンド 0x02 0x03)')
      }
      return original(request, opts)
    }

    await waitFor(session, (s) => s.stalled)
    expect(session.state.status).toBe('ready') // 図は最後の表示のまま
    await waitFor(session, (s) => !s.stalled)
    expect(session.state.status).toBe('ready')
    expect(session.state.error).toBeNull()

    // 読み続けている
    mock.press(0, 1)
    await waitFor(session, (s) => (s.layers?.held.size ?? 0) > 0)
    await session.dispose()
  })

  it('応答が返らないあいだは粘り、限界を超えたら切る', async () => {
    // Windows ではウィンドウの枠をドラッグしているあいだ main のメッセージループが止まり、
    // WebHID の往復が返らない。数秒で切っていたので、ドラッグのたびに繋ぎ直していた
    const opts = options()
    const mock = new MockTransport({ unlocked: true })
    const session = new KeyboardSession(mock, opts)
    await session.start()
    await waitFor(session, (s) => s.status === 'ready')

    const original = mock.send.bind(mock)
    mock.send = async (request, o) => {
      if (request[0] === 0x02) throw new TransportError('デバイスが応答しない(コマンド 0x02 0x03)')
      return original(request, o)
    }
    await waitFor(session, (s) => s.stalled)
    expect(session.state.status).toBe('ready') // 図は最後の表示のまま、まだ切らない

    opts.clock.t += STALL_LIMIT_MS // ドラッグでは説明が付かないほど詰まった
    const stopped = await waitFor(session, (s) => s.status === 'error')
    expect(stopped.error).toContain('応答しない')
    await session.dispose()
  })

  it('時間切れ以外の失敗(デバイスが消えた)は待たずに切る', async () => {
    const { session, mock } = await readySession()
    const original = mock.send.bind(mock)
    mock.send = async (request, opts) => {
      // 書き込みそのものの失敗。待っても直らないので、時間切れの粘りには入れない
      if (request[0] === 0x02) throw new Error('ケーブルが抜けた')
      return original(request, opts)
    }
    const state = await waitFor(session, (s) => s.status === 'error')
    expect(state.error).toBe('ケーブルが抜けた')
    expect(state.stalled).toBe(false)

    // 止まっている: 以後 matrix を読みに行かない
    const before = mock.requests.length
    await new Promise((r) => setTimeout(r, 30))
    expect(mock.requests.length).toBe(before)
    await session.dispose()
  })
})

describe('KeyboardSession: キャッシュから始める', () => {
  /** 定義とキーマップのキャッシュをメモリに持つ(localStorage の代わり)。 */
  function memoryCaches() {
    const definitions = new Map<string, { size: number; definition: VialDefinition }>()
    const keymaps = new Map<string, CachedKeymap>()
    return {
      keymaps,
      definitionCache: {
        get: (uid: string, size: number) => {
          const entry = definitions.get(uid)
          return entry && entry.size === size ? entry.definition : null
        },
        set: (uid: string, size: number, definition: VialDefinition) => {
          definitions.set(uid, { size, definition })
        }
      },
      keymapCache: {
        get: (uid: string) => keymaps.get(uid) ?? null,
        set: (uid: string, value: CachedKeymap) => {
          keymaps.set(uid, value)
        }
      }
    }
  }

  /** キャッシュを満たすために 1 回繋いで切る。 */
  async function warmUp(caches: ReturnType<typeof memoryCaches>): Promise<void> {
    const mock = new MockTransport({ unlocked: true })
    const session = new KeyboardSession(mock, { ...options(), ...caches })
    await session.start()
    await waitFor(session, (s) => s.status === 'ready')
    await session.dispose()
  }

  /** キーマップを読んだ往復の数(0x12 = keymap buffer)。 */
  const keymapReads = (mock: MockTransport): number =>
    mock.requests.filter((request) => request[0] === 0x12).length

  it('2 回目は読まずに図を出し、裏で読み直して確かめる', async () => {
    // モードの切り替えや繋ぎ直しのたびに 70 往復待たされていた(BT では 30 秒)
    const caches = memoryCaches()
    await warmUp(caches)

    const mock = new MockTransport({ unlocked: true })
    const session = new KeyboardSession(mock, { ...options(), ...caches })
    await session.start()
    await waitFor(session, (s) => s.status === 'ready')

    expect(session.state.geometry?.keys).toHaveLength(50) // もう図は出ている
    expect(keymapReads(mock)).toBe(0) // まだ一度もキーマップを読んでいない

    await until(() => keymapReads(mock) > 0) // 裏で読み直している
    await waitFor(session, (s) => !s.reloading)
    expect(session.state.error).toBeNull()
    await session.dispose()
  })

  it('キャッシュが古ければ、裏の確かめで差し替える', async () => {
    const caches = memoryCaches()
    await warmUp(caches)

    const mock = new MockTransport({ unlocked: true })
    mock.setKeycode(0, 0, 1, 0x001d) // 繋いでいない間に Vial で Q → Z に変えた
    const session = new KeyboardSession(mock, { ...options(), ...caches })
    await session.start()
    await waitFor(session, (s) => s.status === 'ready')
    expect(session.state.snapshot?.keymap[0][0][1]).toBe(0x0014) // まだキャッシュの中身(Q)

    await waitFor(session, (s) => s.snapshot?.keymap[0][0][1] === 0x001d)
    // 差し替えたあともポーリングは続く
    mock.press(0, 1)
    await waitFor(session, (s) => (s.layers?.held.size ?? 0) > 0)
    await session.dispose()
  })

  it('ファームを焼き直して定義の大きさが変わったら、キャッシュは使わない', async () => {
    const caches = memoryCaches()
    await warmUp(caches)
    for (const [uid, entry] of caches.keymaps) {
      caches.keymaps.set(uid, { ...entry, definitionSize: entry.definitionSize + 1 })
    }

    const mock = new MockTransport({ unlocked: true })
    const session = new KeyboardSession(mock, { ...options(), ...caches })
    await session.start()
    await waitFor(session, (s) => s.status === 'ready')
    expect(keymapReads(mock)).toBeGreaterThan(0) // 普通に全部読んだ
    await session.dispose()
  })
})

describe('KeyboardSession: 読み直し', () => {
  it('読み直しが時間切れでも、セッションは落とさず前のキーマップで続ける', async () => {
    // ウィンドウに戻った拍子(フォーカスで自動の読み直し)に 1 回詰まっただけで切れていた
    const { session, mock } = await readySession()
    const original = mock.send.bind(mock)
    mock.send = async (request, opts) => {
      if (request[0] === 0x12) throw new TransportError('デバイスが応答しない(コマンド 0x12)')
      return original(request, opts)
    }

    await session.reload()
    expect(session.state.status).toBe('ready')
    expect(session.state.error).toBeNull()
    expect(session.state.reloading).toBe(false)

    // 読み続けている
    mock.send = original
    mock.press(0, 1)
    await waitFor(session, (s) => (s.layers?.held.size ?? 0) > 0)
    await session.dispose()
  })

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

  it('何も変わっていなければ、エンジンも画面もそのまま使う', async () => {
    const { session } = await readySession()
    const { engine, snapshot, geometry } = session.state
    await session.reload()
    expect(session.state.status).toBe('ready')
    expect(session.state.engine).toBe(engine)
    expect(session.state.snapshot).toBe(snapshot)
    expect(session.state.geometry).toBe(geometry)
    await session.dispose()
  })

  it('キーマップが変わっても、TG で固定したレイヤーは残る(キーボード側は固定したまま)', async () => {
    const mock = new MockTransport({ unlocked: true })
    mock.setKeycode(0, 0, 2, 0x5261) // L0 の W を TG(1) に
    const { session } = await readySession(mock)

    mock.press(0, 2)
    await waitFor(session, (s) => s.layers?.toggledLayers.includes(1) === true)
    mock.release(0, 2)
    await waitFor(session, (s) => s.layers?.held.size === 0)

    const engineBefore = session.state.engine
    mock.setKeycode(0, 0, 1, 0x001d) // 別のところを Q → Z(エンジンを作り直させる)
    await session.reload()
    expect(session.state.engine).not.toBe(engineBefore)
    expect(session.state.layers?.toggledLayers).toEqual([1])
    expect(session.state.layers?.displayLayer).toBe(1)
    await session.dispose()
  })

  it('手動の読み直し(full)では定義も読み直すが、ふだんの読み直しでは読まない', async () => {
    const { session, mock } = await readySession()
    const definitionReads = () => mock.requests.filter((r) => r[0] === 0xfe && r[1] === 0x02).length
    const afterLoad = definitionReads()

    await session.reload()
    expect(definitionReads()).toBe(afterLoad)

    const geometry = session.state.geometry
    await session.reload({ full: true })
    expect(definitionReads()).toBeGreaterThan(afterLoad)
    expect(session.state.status).toBe('ready')
    // 定義が変わっていなければ、物理配置は組み直さない
    expect(session.state.geometry).toBe(geometry)
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
