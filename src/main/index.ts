/**
 * メインプロセス。
 *
 * やることは 4 つだけ:
 *   - 通常ウィンドウ / クリック透過オーバーレイの作り分けと切り替え
 *   - WebHID の許可(renderer 側で HID を扱うため。node-hid は使わない)
 *   - グローバルショートカット
 *   - 設定の保存
 */
import { BrowserWindow, app, globalShortcut, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import {
  type Bounds,
  type LabelMode,
  type WindowMode,
  isDeviceGranted,
  loadSettings,
  rememberDevice,
  saveSettings
} from './settings'

const TOGGLE_SHORTCUT = 'Control+Alt+K'
const VIAL_USAGE_PAGE = 0xff60
const VIAL_USAGE = 0x61

let window: BrowserWindow | null = null
let mode: WindowMode = 'normal'

/** select-hid-device のコールバックを、renderer が選ぶまで預かる。 */
let pendingDeviceSelection: ((deviceId: string | null) => void) | null = null

const MIN_WIDTH = 420
const MIN_HEIGHT = 240

/**
 * つまみでの移動・リサイズは毎フレーム飛んでくるので、保存はまとめて行う。
 * setPosition / setSize は 'moved' / 'resized' を必ずしも出さないため、自前で呼ぶ。
 */
let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleBoundsSave(): void {
  if (boundsSaveTimer !== null) clearTimeout(boundsSaveTimer)
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null
    if (!window || window.isDestroyed() || window.isMinimized()) return
    const current = window.getBounds()
    saveSettings(mode === 'overlay' ? { overlayBounds: current } : { normalBounds: current })
  }, 400)
}

function isVialDevice(device: Electron.HIDDevice): boolean {
  return device.collections.some(
    (collection) =>
      collection.usagePage === VIAL_USAGE_PAGE && collection.usage === VIAL_USAGE
  )
}

function createWindow(nextMode: WindowMode, bounds: Bounds): BrowserWindow {
  const overlay = nextMode === 'overlay'
  const settings = loadSettings()

  const win = new BrowserWindow({
    ...bounds,
    show: false,
    title: 'Live Keymap Viewer',
    // 透明ウィンドウは作った後から切り替えられないので、モードごとに作り直す
    transparent: overlay,
    frame: !overlay,
    // オーバーレイは枠が無いので OS のリサイズ境界は出ない。
    // ただし resizable:false だと setSize まで効かなくなるので true にしておき、
    // 大きさは画面内のつまみから変える。
    resizable: true,
    skipTaskbar: overlay,
    alwaysOnTop: overlay,
    backgroundColor: overlay ? '#00000000' : '#11151a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (overlay) {
    // クリックを下のウィンドウに通す。戻すのはショートカットで行う
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setOpacity(settings.overlayOpacity)
  }

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // モード切替中に古いウィンドウから飛んでくるイベントで取り違えないよう、
  // このウィンドウ自身のモードを閉じ込めておく
  const saveBounds = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return
    const current = win.getBounds()
    saveSettings(overlay ? { overlayBounds: current } : { normalBounds: current })
  }
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** 位置とサイズを引き継いだままモードを切り替える。 */
function setMode(nextMode: WindowMode): void {
  if (nextMode === mode && window && !window.isDestroyed()) return

  const bounds = window && !window.isDestroyed() ? window.getBounds() : loadSettings().normalBounds
  const old = window
  mode = nextMode
  saveSettings({
    mode: nextMode,
    ...(nextMode === 'overlay' ? { overlayBounds: bounds } : { normalBounds: bounds })
  })

  window = createWindow(nextMode, bounds)
  window.once('ready-to-show', () => {
    if (old && !old.isDestroyed()) old.destroy()
  })
}

function toggleMode(): void {
  setMode(mode === 'normal' ? 'overlay' : 'normal')
}

function setupHidPermissions(): void {
  const ses = session.defaultSession

  // renderer が navigator.hid を触れるようにする
  ses.setPermissionCheckHandler((_contents, permission) => permission === 'hid')
  ses.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === 'hid')
  )

  // 一度許可したデバイスは、次の起動でも getDevices() に出す
  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'hid') return false
    const device = details.device as Electron.HIDDevice
    return isDeviceGranted(device.vendorId, device.productId)
  })

  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    const candidates = details.deviceList.filter(isVialDevice)

    if (candidates.length === 0) {
      callback(undefined)
      return
    }
    if (candidates.length === 1) {
      rememberDevice({
        vendorId: candidates[0].vendorId,
        productId: candidates[0].productId,
        name: candidates[0].name
      })
      callback(candidates[0].deviceId)
      return
    }

    // 複数あるときは renderer に選ばせる
    pendingDeviceSelection = (deviceId) => {
      const chosen = candidates.find((d) => d.deviceId === deviceId)
      if (chosen) {
        rememberDevice({
          vendorId: chosen.vendorId,
          productId: chosen.productId,
          name: chosen.name
        })
      }
      callback(chosen?.deviceId)
    }
    window?.webContents.send(
      'hid:choose-device',
      candidates.map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        vendorId: d.vendorId,
        productId: d.productId
      }))
    )
  })
}

function setupIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_event, patch: Record<string, unknown>) =>
    saveSettings(patch)
  )
  ipcMain.handle('window:get-mode', () => mode)
  ipcMain.handle('window:set-mode', (_event, next: WindowMode) => {
    setMode(next)
    return mode
  })
  ipcMain.handle('window:toggle-mode', () => {
    toggleMode()
    return mode
  })
  ipcMain.handle('window:set-overlay-opacity', (_event, value: number) => {
    const clamped = Math.min(1, Math.max(0.2, value))
    saveSettings({ overlayOpacity: clamped })
    if (mode === 'overlay') window?.setOpacity(clamped)
    return clamped
  })
  ipcMain.handle('settings:set-label-mode', (_event, value: LabelMode) => {
    saveSettings({ labelMode: value })
    return value
  })
  ipcMain.on('hid:device-chosen', (_event, deviceId: string | null) => {
    pendingDeviceSelection?.(deviceId)
    pendingDeviceSelection = null
  })

  ipcMain.on('window:set-ignore-mouse', (_event, ignore: boolean) => {
    if (mode !== 'overlay' || !window || window.isDestroyed()) return
    window.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('window:move-by', (_event, dx: number, dy: number) => {
    if (!window || window.isDestroyed()) return
    const [x, y] = window.getPosition()
    window.setPosition(Math.round(x + dx), Math.round(y + dy))
    scheduleBoundsSave()
  })

  ipcMain.on('window:resize-by', (_event, dw: number, dh: number) => {
    if (!window || window.isDestroyed()) return
    const [width, height] = window.getSize()
    window.setSize(
      Math.max(MIN_WIDTH, Math.round(width + dw)),
      Math.max(MIN_HEIGHT, Math.round(height + dh))
    )
    scheduleBoundsSave()
  })
}

app.whenReady().then(() => {
  const settings = loadSettings()
  mode = settings.mode

  setupHidPermissions()
  setupIpc()

  window = createWindow(
    mode,
    mode === 'overlay' ? settings.overlayBounds : settings.normalBounds
  )

  // オーバーレイ中はクリックが通らないので、戻すのはショートカットだけが頼り
  if (!globalShortcut.register(TOGGLE_SHORTCUT, toggleMode)) {
    console.warn(`グローバルショートカット ${TOGGLE_SHORTCUT} を登録できなかった`)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      window = createWindow(mode, loadSettings().normalBounds)
    }
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
