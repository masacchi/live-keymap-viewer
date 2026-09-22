/**
 * 接続の持ち方と、切れたときの繋ぎ直し(session/keyboardConnection.ts)。
 *
 * navigator.hid の代わりに偽物を使う。デバイスを開くと MockTransport(ファーム模擬)に
 * 繋がるようにして、抜き差しは「偽物の一覧から消す / 足して connect イベントを出す」、
 * 通信の途切れは「その transport の send を失敗させる」で作る。
 */
import { describe, expect, it } from 'vitest'
import { MockTransport } from '@/hid/mockTransport'
import type { Transport } from '@/hid/transport'
import {
  type ConnectionOptions,
  type ConnectionState,
  type HidLike,
  KeyboardConnection
} from '@/session/keyboardConnection'

const yieldSleep = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

class FakeHid extends EventTarget {
  devices: HIDDevice[] = []

  async getDevices(): Promise<HIDDevice[]> {
    return [...this.devices]
  }

  async requestDevice(): Promise<HIDDevice[]> {
    return this.devices.slice(0, 1)
  }

  /** 挿す。一覧に足して connect イベントを出す。 */
  plug(device: HIDDevice): void {
    this.devices.push(device)
    const event = new Event('connect')
    Object.defineProperty(event, 'device', { value: device })
    this.dispatchEvent(event)
  }

  /** 抜く。一覧から消す(使っていた transport の途切れはテスト側で作る)。 */
  unplug(device: HIDDevice): void {
    this.devices = this.devices.filter((d) => d !== device)
  }
}

function fakeDevice(): HIDDevice {
  return {
    productName: 'Cornix',
    vendorId: 0xe118,
    productId: 0x0001,
    collections: [{ usagePage: 0xff60, usage: 0x61 }]
  } as unknown as HIDDevice
}

/** 通信を途切れさせる(ケーブルが抜けた、スリープで USB が落ちた、の代わり)。 */
function breakTransport(transport: MockTransport): void {
  transport.send = async () => {
    throw new Error('デバイスが外れた')
  }
}

function setup(overrides: ConnectionOptions = {}) {
  const hid = new FakeHid()
  /** 開かれた順の transport。繋ぎ直しのたびに増える。 */
  const opened: MockTransport[] = []
  const connection = new KeyboardConnection({
    hid: hid as unknown as HidLike,
    reconnectDelayMs: 10,
    openTransport: () => {
      const transport = new MockTransport({ unlocked: true })
      opened.push(transport)
      return transport
    },
    pickDevice: async (candidates) => ({ device: candidates[0] ?? null, results: [] }),
    sessionOptions: { sleep: yieldSleep },
    ...overrides
  })
  return { hid, connection, opened }
}

function waitFor(
  connection: KeyboardConnection,
  predicate: (state: ConnectionState) => boolean,
  timeoutMs = 3000
): Promise<ConnectionState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`待ちきれなかった。最後の状態: ${connection.state.status}`))
    }, timeoutMs)
    const unsubscribe = connection.subscribe((state) => {
      if (!predicate(state)) return
      clearTimeout(timer)
      queueMicrotask(() => unsubscribe())
      resolve(state)
    })
  })
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('KeyboardConnection: 繋ぐ', () => {
  it('起動時に、前に許可したデバイスへ自動で繋ぐ', async () => {
    const { hid, connection, opened } = setup()
    hid.devices = [fakeDevice()]
    connection.start()
    await waitFor(connection, (s) => s.status === 'ready')
    expect(opened).toHaveLength(1)
    await connection.dispose()
  })

  it('起動時に無くても、あとで挿されたら繋ぐ', async () => {
    const { hid, connection } = setup()
    connection.start()
    await pause(20)
    expect(connection.state.status).toBe('idle')
    hid.plug(fakeDevice())
    await waitFor(connection, (s) => s.status === 'ready')
    await connection.dispose()
  })
})

describe('KeyboardConnection: 繋ぎ直し', () => {
  it('動いていた実機が途切れたら、しばらくして繋ぎ直す', async () => {
    const { hid, connection, opened } = setup()
    hid.devices = [fakeDevice()]
    connection.start()
    await waitFor(connection, (s) => s.status === 'ready')

    breakTransport(opened[0])
    const broken = await waitFor(connection, (s) => s.status === 'error')
    expect(broken.reconnecting).toBe(true)
    expect(broken.error).toBe('デバイスが外れた')

    const back = await waitFor(connection, (s) => s.status === 'ready')
    expect(back.reconnecting).toBe(false)
    expect(opened).toHaveLength(2)
    await connection.dispose()
  })

  it('デバイスが無いあいだは待ち、挿されたら(connect イベントで)すぐ繋ぐ', async () => {
    // タイマーでは間に合わない長さにして、イベントで繋がることを確かめる
    const { hid, connection, opened } = setup({ reconnectDelayMs: 60_000 })
    const device = fakeDevice()
    hid.devices = [device]
    connection.start()
    await waitFor(connection, (s) => s.status === 'ready')

    hid.unplug(device)
    breakTransport(opened[0])
    await waitFor(connection, (s) => s.status === 'error' && s.reconnecting)

    hid.plug(fakeDevice())
    await waitFor(connection, (s) => s.status === 'ready')
    expect(opened).toHaveLength(2)
    await connection.dispose()
  })

  it('抜かれたままなら、挿されるまで探し続ける', async () => {
    const { hid, connection, opened } = setup()
    const device = fakeDevice()
    hid.devices = [device]
    connection.start()
    await waitFor(connection, (s) => s.status === 'ready')

    hid.unplug(device)
    breakTransport(opened[0])
    await waitFor(connection, (s) => s.status === 'error')
    await pause(50) // 何度か探すが、何も無い
    expect(opened).toHaveLength(1)
    expect(connection.state.reconnecting).toBe(true)

    hid.devices = [fakeDevice()] // イベント無しで戻ってきても、タイマーで拾う
    await waitFor(connection, (s) => s.status === 'ready')
    await connection.dispose()
  })

  it('「切断」を押したあとは、挿し直されても繋がない', async () => {
    const { hid, connection, opened } = setup()
    hid.devices = [fakeDevice()]
    connection.start()
    await waitFor(connection, (s) => s.status === 'ready')

    await connection.disconnect()
    hid.plug(fakeDevice())
    await pause(50)
    expect(connection.state.status).toBe('idle')
    expect(opened).toHaveLength(1)
    await connection.dispose()
  })

  it('モックで試しているあいだは、実機が挿されても乗り換えない', async () => {
    const { hid, connection, opened } = setup({
      createMock: () => new MockTransport({ unlocked: true })
    })
    connection.start()
    await connection.connectMock()
    await waitFor(connection, (s) => s.status === 'ready')

    hid.plug(fakeDevice())
    await pause(50)
    expect(opened).toHaveLength(0)
    expect(connection.state.deviceLabel).toBe('Cornix LP (モック)')
    await connection.dispose()
  })

  it('動いている接続があれば、別のインターフェースが繋がっても乗り換えない', async () => {
    const { hid, connection, opened } = setup()
    hid.devices = [fakeDevice()]
    connection.start()
    await waitFor(connection, (s) => s.status === 'ready')

    hid.plug(fakeDevice()) // USB で使っているところに BT 側が繋がった、など
    await pause(50)
    expect(opened).toHaveLength(1)
    expect(connection.state.status).toBe('ready')
    await connection.dispose()
  })

  it('読み込みの途中で失敗したもの(一度も動いていない)は、タイマーでは繋ぎ直さない', async () => {
    let opens = 0
    const { hid, connection } = setup({
      openTransport: (): Transport => {
        opens++
        const transport = new MockTransport({ unlocked: true })
        breakTransport(transport) // 未対応のファームなど、何度やっても同じ失敗の代わり
        return transport
      }
    })
    hid.devices = [fakeDevice()]
    connection.start()
    const failed = await waitFor(connection, (s) => s.status === 'error')
    expect(failed.reconnecting).toBe(false)
    await pause(50)
    expect(opens).toBe(1)
    await connection.dispose()
  })

  it('モックはキーをクリックで押す/離すを切り替えられる', async () => {
    const { connection } = setup({ createMock: () => new MockTransport({ unlocked: true }) })
    connection.start()
    await connection.connectMock()
    const ready = await waitFor(connection, (s) => s.status === 'ready')
    expect(ready.mock).toBe(true)

    connection.toggleMockKey(0, 1) // Q を押したままにする
    await waitFor(connection, (s) => s.layers?.held.has('0,1') === true)
    connection.toggleMockKey(0, 1) // もう一度で離す
    await waitFor(connection, (s) => s.layers?.held.size === 0)
    await connection.dispose()
  })

  it('実機ではクリックしても何も起きない', async () => {
    const { hid, connection, opened } = setup()
    hid.devices = [fakeDevice()]
    connection.start()
    const ready = await waitFor(connection, (s) => s.status === 'ready')
    expect(ready.mock).toBe(false)
    connection.toggleMockKey(0, 1)
    expect(opened[0].isPressed(0, 1)).toBe(false)
    await connection.dispose()
  })

  it('破棄したあとは、挿されても何もしない', async () => {
    const { hid, connection, opened } = setup()
    connection.start()
    await connection.dispose()
    hid.plug(fakeDevice())
    await pause(30)
    expect(opened).toHaveLength(0)
  })
})
