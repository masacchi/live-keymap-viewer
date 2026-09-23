/**
 * renderer からの IPC を受ける。
 *
 * 読み込むのはローカルのファイルだけだが、renderer から来た値はここで型と範囲を
 * 確かめてから使う。preload の API に無いことは受け付けない。
 */
import { app, ipcMain } from 'electron'
import { type AppInfo, IPC } from '../shared/ipc'
import {
  type GrantedDevice,
  isKeyboardUid,
  MAX_LAYERS,
  pickRendererPatch,
  type Settings,
  withLayerName,
  withoutDevice
} from '../shared/settings'
import { BUILD_TIME } from './buildInfo'
import type { HidPermissions } from './hid'
import { log, logPath } from './log'
import { loadSettings, saveSettings } from './settings'
import type { WindowManager } from './windows'

/** renderer から来たエラーの、残す長さの上限。 */
const LOG_MESSAGE_MAX = 300
const LOG_DETAIL_MAX = 2000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function registerIpc(windows: WindowManager, hid: HidPermissions): void {
  ipcMain.handle(
    IPC.appGetInfo,
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      buildTime: BUILD_TIME,
      logPath: logPath()
    })
  )

  ipcMain.handle(IPC.settingsGet, () => loadSettings())

  // 変えてよい項目だけを取り出し、値は保存するときに sanitizeSettings が確かめる
  ipcMain.handle(IPC.settingsUpdate, (_event, patch: unknown): Settings => {
    const saved = saveSettings(pickRendererPatch(patch))
    windows.applySettings(saved)
    return saved
  })

  ipcMain.handle(
    IPC.settingsSetLayerName,
    (_event, uid: unknown, layer: unknown, name: unknown): string[] => {
      if (!isKeyboardUid(uid)) return []
      const current = loadSettings().layerNames
      if (!Number.isInteger(layer) || (layer as number) < 0 || (layer as number) >= MAX_LAYERS) {
        return current[uid] ?? []
      }
      const layerNames = withLayerName(
        current,
        uid,
        layer as number,
        typeof name === 'string' ? name : ''
      )
      saveSettings({ layerNames })
      return layerNames[uid] ?? []
    }
  )

  ipcMain.handle(
    IPC.settingsForgetDevice,
    (_event, vendorId: unknown, productId: unknown): GrantedDevice[] => {
      const current = loadSettings().grantedDevices
      if (!Number.isInteger(vendorId) || !Number.isInteger(productId)) return current
      return saveSettings({
        grantedDevices: withoutDevice(current, vendorId as number, productId as number)
      }).grantedDevices
    }
  )

  ipcMain.handle(IPC.windowGetMode, () => windows.mode)

  ipcMain.handle(IPC.windowToggleMode, () => {
    windows.toggleMode()
    return windows.mode
  })

  ipcMain.on(IPC.windowSetOverlayBlurActive, (_event, active: unknown) => {
    windows.setOverlayBlurActive(active !== false)
  })

  ipcMain.on(IPC.windowSetIgnoreMouse, (_event, ignore: unknown) => {
    windows.setIgnoreMouseEvents(ignore !== false)
  })

  ipcMain.on(IPC.windowMoveBy, (_event, dx: unknown, dy: unknown) => {
    if (isFiniteNumber(dx) && isFiniteNumber(dy)) windows.moveBy(dx, dy)
  })

  ipcMain.on(IPC.windowResizeBy, (_event, dw: unknown, dh: unknown) => {
    if (isFiniteNumber(dw) && isFiniteNumber(dh)) windows.resizeBy(dw, dh)
  })

  ipcMain.on(IPC.hidDeviceChosen, (_event, deviceId: unknown) => {
    hid.resolve(typeof deviceId === 'string' ? deviceId : null)
  })

  // 「手放した」の返事。待っているモード切り替えがあれば、そこで先へ進む
  ipcMain.on(IPC.hidReleased, () => windows.noteHidReleased())

  // 画面で起きたエラー。長いスタックがそのまま来るので、ログが 1 件で埋まらないように切る
  ipcMain.on(IPC.logReport, (_event, message: unknown, detail: unknown) => {
    if (typeof message !== 'string' || message === '') return
    log(
      'error',
      `renderer: ${message.slice(0, LOG_MESSAGE_MAX)}`,
      typeof detail === 'string' ? detail.slice(0, LOG_DETAIL_MAX) : undefined
    )
  })
}
