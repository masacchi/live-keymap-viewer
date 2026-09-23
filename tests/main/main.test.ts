/**
 * main プロセスのテスト。electron はモックに差し替える。
 * 実際のウィンドウは出さず、呼ばれ方と保存される設定を確かめる。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      this.backgroundColor = options.backgroundColor as string | undefined
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
    /** setBackgroundMaterial で最後に渡されたもの。呼ばれていなければ null。 */
    material: string | null = null
    /** いまの背景色。作ったときの backgroundColor から始まる。 */
    backgroundColor: string | undefined = undefined
    setBackgroundMaterial(material: string): void {
      this.material = material
      // Electron と同じく、材質に合わせて背景色も塗り直す(v44 の electron_api_browser_window.cc)。
      // 'none' では白にされるので、透明なオーバーレイが白い板になる
      if (material === 'none') this.backgroundColor = '#FFFFFFFF'
      else if (['acrylic', 'mica', 'tabbed'].includes(material)) this.backgroundColor = '#00000000'
    }
    setBackgroundColor(color: string): void {
      this.backgroundColor = color
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
    devicePermissionHandler: null as null | Handler,
    /** shell.openPath に渡されたパス。 */
    opened: [] as string[]
  }

  return { FakeWindow, state }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => fake.state.userData,
    getVersion: () => '9.9.9-test',
    getAppPath: () => '/app'
  },
  BrowserWindow: fake.FakeWindow,
  screen: { getAllDisplays: () => fake.state.displays },
  shell: {
    openExternal: () => Promise.resolve(),
    openPath: (path: string) => {
      fake.state.opened.push(path)
      return Promise.resolve('')
    }
  },
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
  const logging = await import('../../src/main/log')
  const windows = new WindowManager()
  const hid = new HidPermissions(windows)
  return { windows, hid, registerIpc, settings, logging }
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
  fake.state.opened = []
  fake.FakeWindow.all = []
})

afterEach(() => {
  rmSync(fake.state.userData, { recursive: true, force: true })
})

describe('log.ts', () => {
  const logFile = (): string => join(fake.state.userData, 'log.txt')

  // log() は端末にも出す(開発中はそちらを見る)。テストではファイルだけを見るので黙らせる
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('起動の印に版が入る(どのビルドが動いていたかが分かる)', async () => {
    const { logging } = await loadMain()
    // process のハンドラはテストの環境に残さない
    const before = process.listeners('uncaughtException')
    logging.installLogging()
    for (const listener of process.listeners('uncaughtException')) {
      if (!before.includes(listener)) process.off('uncaughtException', listener)
    }
    expect(readFileSync(logFile(), 'utf8')).toContain('起動 v9.9.9-test')
  })

  it('例外はスタックまで残す', async () => {
    const { logging } = await loadMain()
    logging.log('error', '転んだ', new Error('ぐえ'))
    const text = readFileSync(logFile(), 'utf8')
    expect(text).toContain('[error] 転んだ')
    expect(text).toContain('Error: ぐえ')
  })

  it('古い行は捨てて、無限には伸びない', async () => {
    const { logging } = await loadMain()
    for (let i = 0; i < 600; i++) logging.log('info', `行 ${i}`)
    const lines = readFileSync(logFile(), 'utf8').split('\n').filter(Boolean)
    expect(lines.length).toBeLessThanOrEqual(500)
    expect(lines.at(-1)).toContain('行 599')
    expect(readFileSync(logFile(), 'utf8')).not.toContain('行 0 ')
  })

  it('前の起動のログは残したまま続きを書く', async () => {
    writeFileSync(logFile(), '前の起動の行\n')
    const { logging } = await loadMain()
    logging.log('info', '今の起動の行')
    const text = readFileSync(logFile(), 'utf8')
    expect(text).toContain('前の起動の行')
    expect(text).toContain('今の起動の行')
  })
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
    settings.flushSettings()
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8')).labelMode).toBe('us')
  })

  it('続けて変えてもディスクへの書き込みは 1 回にまとめる(値はその場で読める)', async () => {
    // スライダーはつまみを 1 回動かすだけで十数回飛んでくる。そのたびに同期で書いていたので、
    // main が細かく詰まり、WebHID の往復まで返らなくなっていた
    const { settings } = await loadMain()
    vi.useFakeTimers()
    try {
      for (let percent = 20; percent <= 100; percent += 5) {
        settings.saveSettings({ overlayOpacity: percent / 100 })
      }
      expect(settings.loadSettings().overlayOpacity).toBe(1) // 値はもう見えている
      expect(existsSync(settingsFile())).toBe(false) // まだ書いていない

      vi.advanceTimersByTime(400)
      expect(JSON.parse(readFileSync(settingsFile(), 'utf8')).overlayOpacity).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('溜めたまま終わらないよう、終了時に書き出せる', async () => {
    const { settings } = await loadMain()
    vi.useFakeTimers()
    try {
      settings.saveSettings({ labelMode: 'us' })
      settings.flushSettings()
      expect(JSON.parse(readFileSync(settingsFile(), 'utf8')).labelMode).toBe('us')
    } finally {
      vi.useRealTimers()
    }
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
    windows.noteHidReleased() // 古い方がキーボードを手放してから作る
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

  describe('モードの切り替えでは、古いウィンドウにキーボードを手放させてから作る', () => {
    // 作り直した renderer は、できた瞬間から同じキーボードに話しかける。古い方がまだ
    // matrix を読んでいると応答が混ざり(0xFE は照合できない)、新しい方の読み込みが壊れる

    it('手放したと返事が来るまで、新しいウィンドウを作らない', async () => {
      const { windows } = await loadMain()
      windows.open()
      const first = fake.FakeWindow.all[0]

      windows.toggleMode()
      expect(windows.mode).toBe('overlay') // モードはすぐ変わる(表示だけ後)
      expect(fake.FakeWindow.all).toHaveLength(1)
      expect(first.sent.map(([channel]) => channel)).toContain('hid:release')

      windows.noteHidReleased()
      expect(fake.FakeWindow.all).toHaveLength(2)
      expect(fake.FakeWindow.all[1].options.transparent).toBe(true)
    })

    it('返事が来なくても、待ちすぎずに切り替える', async () => {
      const { windows } = await loadMain()
      windows.open()
      vi.useFakeTimers()
      try {
        windows.toggleMode()
        expect(fake.FakeWindow.all).toHaveLength(1)
        vi.advanceTimersByTime(600)
        expect(fake.FakeWindow.all).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('連打で元のモードに戻ったら、作り直さない', async () => {
      const { windows } = await loadMain()
      windows.open()
      windows.toggleMode()
      windows.toggleMode()
      expect(windows.mode).toBe('normal')
      expect(fake.FakeWindow.all).toHaveLength(1)
      // 宙に浮いた返事が来ても、取り消した切り替えは進まない
      windows.noteHidReleased()
      expect(fake.FakeWindow.all).toHaveLength(1)
    })
  })

  describe('設定を変えたときにウィンドウへ効かせるもの', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const onPlatform = (value: string) => Object.defineProperty(process, 'platform', { value })
    afterEach(() => Object.defineProperty(process, 'platform', platform))

    async function setup(settings: Record<string, unknown>) {
      writeFileSync(settingsFile(), JSON.stringify(settings))
      const main = await loadMain()
      main.registerIpc(main.windows, main.hid)
      main.windows.open()
      return { ...main, win: fake.FakeWindow.all[0] }
    }

    it('濃さはウィンドウに掛けない(renderer が中身に掛ける。保存はする)', async () => {
      // setOpacity はぼかしごと薄くし、ぼけていない後ろの画面が透けてしまう
      const { win, settings } = await setup({ mode: 'overlay', overlayOpacity: 0.7 })
      expect(win.opacity).toBe(1)
      await invoke('settings:update', { overlayOpacity: 0.5 })
      expect(win.opacity).toBe(1)
      expect(settings.loadSettings().overlayOpacity).toBe(0.5)
    })

    it('Windows のオーバーレイでは、ぼかしを入れればアクリルにし、薄くしているあいだは外す', async () => {
      onPlatform('win32')
      const { win, windows, settings } = await setup({ mode: 'overlay', overlayBlur: true })
      expect(win.material).toBe('acrylic') // 保存した設定で開く

      windows.setOverlayBlurActive(false)
      expect(win.material).toBe('none')
      windows.setOverlayBlurActive(true)
      expect(win.material).toBe('acrylic')

      await invoke('settings:update', { overlayBlur: false })
      expect(win.material).toBe('none')
      expect(settings.loadSettings().overlayBlur).toBe(false)
    })

    it('ぼかしを外しても、オーバーレイの背景は透明のまま(Electron が白で塗り直すのを戻す)', async () => {
      // 「L0 で薄く」で薄くするたびに背景が白い板になり、濃く戻すと直っていた
      onPlatform('win32')
      const { win, windows } = await setup({ mode: 'overlay', overlayBlur: true })
      windows.setOverlayBlurActive(false)
      expect(win.material).toBe('none')
      expect(win.backgroundColor).toBe('#00000000')
    })

    it('ぼかしを切った設定で開いても、オーバーレイの背景は透明', async () => {
      onPlatform('win32')
      const { win } = await setup({ mode: 'overlay', overlayBlur: false })
      expect(win.backgroundColor).toBe('#00000000')
    })

    it('Windows 以外ではぼかしに何もしない(保存はする)', async () => {
      onPlatform('linux')
      const { win, settings } = await setup({ mode: 'overlay' })
      await invoke('settings:update', { overlayBlur: true })
      expect(win.material).toBeNull()
      expect(settings.loadSettings().overlayBlur).toBe(true)
    })
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

  it('どのビルドが動いているかを返す(版・Electron・ログの置き場所)', async () => {
    await setup()
    expect(await invoke('app:get-info')).toMatchObject({
      version: '9.9.9-test',
      electron: process.versions.electron,
      logPath: join(fake.state.userData, 'log.txt')
    })
  })

  it('ログは OS の既定のアプリで開く(パスを出すだけでは辿る手間が残る)', async () => {
    await setup()
    emit('log:open')
    expect(fake.state.opened).toEqual([join(fake.state.userData, 'log.txt')])
  })

  it('設定は変えてよい項目だけを受け付け、保存した設定をまるごと返す', async () => {
    const { settings } = await setup()
    const saved = (await invoke('settings:update', {
      labelMode: 'us',
      encoderPlacement: 'top',
      // renderer からは変えさせない項目
      mode: 'overlay',
      grantedDevices: [{ vendorId: 1, productId: 2 }],
      evil: true
    })) as Record<string, unknown>
    expect(saved).toMatchObject({ labelMode: 'us', encoderPlacement: 'top', mode: 'normal' })
    expect(saved).not.toHaveProperty('evil')
    expect(settings.loadSettings().grantedDevices).toEqual([])
    expect(await invoke('settings:update', 'garbage')).toMatchObject({ labelMode: 'us' })
  })

  it('壊れた値は、手で直したファイルと同じく項目ごとに既定値へ戻し、範囲外は丸める', async () => {
    const { settings } = await setup()
    await invoke('settings:update', {
      labelMode: 'klingon',
      overlayAutoFade: 'no',
      overlayFadedOpacity: 0.9,
      overlayOpacity: 0,
      overlayBlur: 'yes'
    })
    expect(settings.loadSettings()).toMatchObject({
      labelMode: 'jis',
      overlayAutoFade: true,
      overlayFadedOpacity: 0.8,
      overlayOpacity: 0.2,
      overlayBlur: false
    })
  })

  it('許可したキーボードは VID / PID を確かめてから忘れる', async () => {
    writeFileSync(
      settingsFile(),
      JSON.stringify({
        grantedDevices: [
          { vendorId: 0xe118, productId: 1, name: 'Cornix' },
          { vendorId: 0x1234, productId: 5 }
        ]
      })
    )
    const { settings } = await setup()
    expect(await invoke('settings:forget-device', '0xe118', 1)).toHaveLength(2) // 変えない
    expect(await invoke('settings:forget-device', 0xe118, 1)).toEqual([
      { vendorId: 0x1234, productId: 5 }
    ])
    expect(settings.loadSettings().grantedDevices).toEqual([{ vendorId: 0x1234, productId: 5 }])
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

  it('画面から報告されたエラーはログに残す。文字列でないものは捨て、長すぎるものは切る', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await setup()
    const logFile = join(fake.state.userData, 'log.txt')
    emit('log:report', 'error', { evil: true })
    emit('log:report', 'error', '')
    expect(existsSync(logFile)).toBe(false)

    emit('log:report', 'info', '応答待ちから戻った(3.2 秒)')
    emit('log:report', 'error', 'あ'.repeat(400), 'ス'.repeat(3000))
    const text = readFileSync(logFile, 'utf8')
    expect(text).toContain('[info] renderer: 応答待ちから戻った(3.2 秒)')
    expect(text).toContain('[error] renderer: ')
    // 見出しは 300 文字、詳細は 2000 文字まで
    expect(text.match(/あ+/)?.[0]).toHaveLength(300)
    expect(text.match(/ス+/)?.[0]).toHaveLength(2000)
    vi.restoreAllMocks()
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
