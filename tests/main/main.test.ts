/**
 * main プロセスのテスト。electron はモックに差し替える。
 * 実際のウィンドウは出さず、呼ばれ方と保存される設定を確かめる。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown

  class FakeWindow {
    static all: FakeWindow[] = []
    destroyed = false
    bounds: { x: number; y: number; width: number; height: number }
    opacity = 1
    ignoreMouse: boolean | null = null
    readonly listeners = new Map<string, Handler[]>()
    readonly sent: Array<[string, unknown[]]> = []
    readonly webContents = {
      send: (channel: string, ...args: unknown[]) => this.sent.push([channel, args]),
      setWindowOpenHandler: () => undefined
    }

    constructor(readonly options: Record<string, unknown>) {
      this.bounds = {
        x: options.x as number,
        y: options.y as number,
        width: options.width as number,
        height: options.height as number
      }
      FakeWindow.all.push(this)
    }
    static getAllWindows(): FakeWindow[] {
      return FakeWindow.all.filter((w) => !w.destroyed)
    }
    on(event: string, handler: Handler): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler])
    }
    once(event: string, handler: Handler): void {
      this.on(event, handler)
    }
    emit(event: string): void {
      for (const handler of this.listeners.get(event) ?? []) handler()
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      this.destroyed = true
    }
    isMinimized(): boolean {
      return false
    }
    getBounds() {
      return { ...this.bounds }
    }
    getPosition(): [number, number] {
      return [this.bounds.x, this.bounds.y]
    }
    setPosition(x: number, y: number): void {
      this.bounds = { ...this.bounds, x, y }
    }
    getSize(): [number, number] {
      return [this.bounds.width, this.bounds.height]
    }
    setSize(width: number, height: number): void {
      this.bounds = { ...this.bounds, width, height }
    }
    setIgnoreMouseEvents(ignore: boolean): void {
      this.ignoreMouse = ignore
    }
    setOpacity(value: number): void {
      this.opacity = value
    }
    shown = false
    show(): void {
      this.shown = true
    }
    setAlwaysOnTop(): void {}
    setVisibleOnAllWorkspaces(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
  }

  const state = {
    userData: '',
    displays: [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    ipcHandlers: new Map<string, Handler>(),
    ipcListeners: new Map<string, Handler>(),
    sessionListeners: new Map<string, Handler>(),
    devicePermissionHandler: null as null | Handler
  }

  return { FakeWindow, state }
})

vi.mock('electron', () => ({
  app: { getPath: () => fake.state.userData },
  BrowserWindow: fake.FakeWindow,
  screen: { getAllDisplays: () => fake.state.displays },
  shell: { openExternal: () => Promise.resolve() },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      fake.state.ipcHandlers.set(channel, handler),
    on: (channel: string, handler: (...args: unknown[]) => unknown) =>
      fake.state.ipcListeners.set(channel, handler)
  },
  session: {
    defaultSession: {
      setPermissionCheckHandler: () => undefined,
      setPermissionRequestHandler: () => undefined,
      setDevicePermissionHandler: (handler: (...args: unknown[]) => unknown) => {
        fake.state.devicePermissionHandler = handler
      },
      on: (event: string, handler: (...args: unknown[]) => unknown) =>
        fake.state.sessionListeners.set(event, handler)
    }
  }
}))

const settingsFile = (): string => join(fake.state.userData, 'settings.json')

/** 毎回まっさらな状態で main のモジュールを読み込み直す(settings.ts のキャッシュも消える)。 */
async function loadMain() {
  vi.resetModules()
  const { WindowManager } = await import('../../src/main/windows')
  const { HidPermissions } = await import('../../src/main/hid')
  const { registerIpc } = await import('../../src/main/ipc')
  const settings = await import('../../src/main/settings')
  const windows = new WindowManager()
  const hid = new HidPermissions(windows)
  return { windows, hid, registerIpc, settings }
}

const invoke = (channel: string, ...args: unknown[]): unknown =>
  fake.state.ipcHandlers.get(channel)!({}, ...args)
const emit = (channel: string, ...args: unknown[]): unknown =>
  fake.state.ipcListeners.get(channel)!({}, ...args)

beforeEach(() => {
  fake.state.userData = mkdtempSync(join(tmpdir(), 'lkv-main-'))
  fake.state.displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]
  fake.state.ipcHandlers.clear()
  fake.state.ipcListeners.clear()
  fake.state.sessionListeners.clear()
  fake.FakeWindow.all = []
})

afterEach(() => {
  rmSync(fake.state.userData, { recursive: true, force: true })
})

describe('settings.ts', () => {
  it('壊れた設定ファイルでも既定値で起動できる', async () => {
    writeFileSync(settingsFile(), '{ this is not json')
    const { settings } = await loadMain()
    expect(settings.loadSettings().mode).toBe('normal')
  })

  it('おかしな値は項目ごとに直して読む', async () => {
    writeFileSync(settingsFile(), JSON.stringify({ mode: 'overlay', overlayOpacity: 99 }))
    const { settings } = await loadMain()
    expect(settings.loadSettings()).toMatchObject({ mode: 'overlay', overlayOpacity: 1 })
  })

  it('保存したものが読める(一時ファイル経由で書く)', async () => {
    const { settings } = await loadMain()
    settings.saveSettings({ labelMode: 'us' })
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8')).labelMode).toBe('us')
  })
})

describe('WindowManager', () => {
  it('前回のモードで開く', async () => {
    writeFileSync(settingsFile(), JSON.stringify({ mode: 'overlay' }))
    const { windows } = await loadMain()
    windows.open()
    const win = fake.FakeWindow.all[0]
    expect(windows.mode).toBe('overlay')
    expect(win.options.transparent).toBe(true)
    expect(win.ignoreMouse).toBe(true) // クリック透過で始まる
  })

  it('外したモニターの上に保存されていた位置は、主画面に戻して開く', async () => {
    writeFileSync(
      settingsFile(),
      JSON.stringify({ normalBounds: { x: 3000, y: 100, width: 800, height: 400 } })
    )
    const { windows } = await loadMain()
    windows.open()
    const { x } = fake.FakeWindow.all[0].bounds
    expect(x).toBeLessThan(1920)
  })

  it('モードを変えるとウィンドウを作り直し、位置とサイズを引き継ぐ', async () => {
    const { windows } = await loadMain()
    windows.open()
    const first = fake.FakeWindow.all[0]
    first.setPosition(200, 150)

    windows.toggleMode()
    const second = fake.FakeWindow.all[1]
    expect(windows.mode).toBe('overlay')
    expect(second.bounds).toMatchObject({ x: 200, y: 150 })

    // 新しい方が出てから古い方を消す
    expect(first.destroyed).toBe(false)
    second.emit('ready-to-show')
    expect(first.destroyed).toBe(true)
  })

  it('同じモードへの切り替えでは作り直さない', async () => {
    const { windows } = await loadMain()
    windows.open()
    windows.setMode('normal')
    expect(fake.FakeWindow.all).toHaveLength(1)
  })

  it('不透明度はオーバーレイのときだけウィンドウに効かせる(保存はする)', async () => {
    const { windows, settings } = await loadMain()
    windows.open()
    windows.setOverlayOpacity(0.5)
    expect(fake.FakeWindow.all[0].opacity).toBe(1)
    expect(settings.loadSettings().overlayOpacity).toBe(0.5)
  })

  it('リサイズは最小サイズを下回らない', async () => {
    const { windows } = await loadMain()
    windows.open()
    windows.resizeBy(-5000, -5000)
    expect(fake.FakeWindow.all[0].bounds).toMatchObject({ width: 420, height: 240 })
  })
})

describe('registerIpc: renderer からの値を確かめてから使う', () => {
  async function setup() {
    const main = await loadMain()
    main.registerIpc(main.windows, main.hid)
    main.windows.open()
    return main
  }

  it('ラベルモードは jis / us 以外を受け付けない', async () => {
    const { settings } = await setup()
    expect(await invoke('settings:set-label-mode', 'us')).toBe('us')
    expect(await invoke('settings:set-label-mode', 'klingon')).toBe('jis')
    expect(settings.loadSettings().labelMode).toBe('jis')
  })

  it('自動フェードは真偽値だけを受け付ける', async () => {
    const { settings } = await setup()
    expect(await invoke('settings:set-overlay-auto-fade', false)).toBe(false)
    expect(await invoke('settings:set-overlay-auto-fade', 'true')).toBe(false) // 変えない
    expect(settings.loadSettings().overlayAutoFade).toBe(false)
  })

  it('ノブの置き場所は top / bottom 以外を受け付けない', async () => {
    const { settings } = await setup()
    expect(await invoke('settings:set-encoder-placement', 'top')).toBe('top')
    expect(settings.loadSettings().encoderPlacement).toBe('top')
    expect(await invoke('settings:set-encoder-placement', 'left')).toBe('bottom')
    expect(settings.loadSettings().encoderPlacement).toBe('bottom')
  })

  it('レイヤー名は UID とレイヤー番号を確かめてから保存する', async () => {
    const { settings } = await setup()
    const uid = '16882930253541522617'
    expect(await invoke('settings:set-layer-name', uid, 2, '記号')).toEqual(['', '', '記号'])
    expect(settings.loadSettings().layerNames[uid]).toEqual(['', '', '記号'])
    // UID でない・番号が範囲外・名前が文字列でない
    expect(await invoke('settings:set-layer-name', '../etc', 0, 'x')).toEqual([])
    expect(await invoke('settings:set-layer-name', uid, 99, 'x')).toEqual(['', '', '記号'])
    expect(await invoke('settings:set-layer-name', uid, 2, { evil: true })).toEqual([])
    expect(settings.loadSettings().layerNames).toEqual({})
  })

  it('不透明度は範囲に丸め、数値でなければ既定値', async () => {
    await setup()
    expect(await invoke('window:set-overlay-opacity', 0)).toBe(0.2)
    expect(await invoke('window:set-overlay-opacity', 'x')).toBe(0.82)
  })

  it('移動量が数値でなければ何もしない', async () => {
    await setup()
    const win = fake.FakeWindow.all[0]
    const before = win.getBounds()
    emit('window:move-by', Number.NaN, 10)
    emit('window:move-by', '10', 10)
    expect(win.getBounds()).toEqual(before)
    emit('window:move-by', 10, 5)
    expect(win.getBounds()).toMatchObject({ x: before.x + 10, y: before.y + 5 })
  })

  it('クリック透過の切り替えは、オーバーレイでなければ無視する', async () => {
    await setup()
    const win = fake.FakeWindow.all[0]
    emit('window:set-ignore-mouse', false)
    expect(win.ignoreMouse).toBeNull()
  })
})

describe('HidPermissions', () => {
  const vial = (id: string, productId = 1) => ({
    deviceId: id,
    name: `kb-${id}`,
    vendorId: 0xe118,
    productId,
    collections: [{ usagePage: 0xff60, usage: 0x61 }]
  })
  const keyboardOnly = {
    deviceId: 'plain',
    name: 'plain',
    vendorId: 1,
    productId: 1,
    collections: [{ usagePage: 0x01, usage: 0x06 }]
  }

  async function setup() {
    const main = await loadMain()
    main.hid.install()
    main.registerIpc(main.windows, main.hid)
    main.windows.open()
    const select = (deviceList: unknown[]) => {
      const callback = vi.fn()
      fake.state.sessionListeners.get('select-hid-device')!(
        { preventDefault: () => undefined },
        { deviceList },
        callback
      )
      return callback
    }
    return { ...main, select }
  }

  it('Vial の候補が 1 つなら、それを選んで覚える', async () => {
    const { select, settings } = await setup()
    const callback = select([keyboardOnly, vial('a')])
    expect(callback).toHaveBeenCalledWith('a')
    expect(settings.isDeviceGranted(0xe118, 1)).toBe(true)
  })

  it('Vial の候補が無ければ取り消す', async () => {
    const { select } = await setup()
    const callback = select([keyboardOnly])
    expect(callback).toHaveBeenCalledWith(undefined)
  })

  it('同じキーボードが USB と Bluetooth の両方で見えていても、選ばせずに進む', async () => {
    const { select } = await setup()
    // 名前も VID/PID も同じ。どちらが答えるかは renderer が確かめる
    const callback = select([vial('usb', 1), vial('bt', 1)])
    expect(callback).toHaveBeenCalledWith('usb')
    expect(fake.FakeWindow.all[0].sent).toHaveLength(0)
  })

  it('別々のキーボードが複数あれば renderer に選ばせ、選ばれたものを返す', async () => {
    const { select } = await setup()
    const callback = select([vial('a', 1), vial('b', 2)])
    expect(callback).not.toHaveBeenCalled()
    const sent = fake.FakeWindow.all[0].sent
    expect(sent[0][0]).toBe('hid:choose-device')

    emit('hid:device-chosen', 'b')
    expect(callback).toHaveBeenCalledWith('b')
  })

  it('選んでいる途中で次の要求が来たら、前のものは取り消す(宙に浮かせない)', async () => {
    const { select } = await setup()
    const first = select([vial('a', 1), vial('b', 2)])
    const second = select([vial('a', 1), vial('b', 2)])
    expect(first).toHaveBeenCalledWith(undefined)
    emit('hid:device-chosen', 'a')
    expect(second).toHaveBeenCalledWith('a')
  })

  it('許可済みのデバイスだけ、次の起動でも見せる', async () => {
    const { select } = await setup()
    select([vial('a', 7)])
    const handler = fake.state.devicePermissionHandler!
    expect(handler({ deviceType: 'hid', device: { vendorId: 0xe118, productId: 7 } })).toBe(true)
    expect(handler({ deviceType: 'hid', device: { vendorId: 0xe118, productId: 8 } })).toBe(false)
    expect(handler({ deviceType: 'usb', device: { vendorId: 0xe118, productId: 7 } })).toBe(false)
  })
})
