/**
 * renderer からの IPC を受ける。
 *
 * 読み込むのはローカルのファイルだけだが、renderer から来た値はここで型と範囲を
 * 確かめてから使う。preload の API に無いことは受け付けない。
 */
import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { isKeyboardUid, type LabelMode, MAX_LAYERS, withLayerName } from '../shared/settings'
import type { HidPermissions } from './hid'
import { loadSettings, saveSettings } from './settings'
import type { WindowManager } from './windows'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function registerIpc(windows: WindowManager, hid: HidPermissions): void {
  ipcMain.handle(IPC.settingsGet, () => loadSettings())

  ipcMain.handle(IPC.settingsSetLabelMode, (_event, value: unknown): LabelMode => {
    const labelMode: LabelMode = value === 'us' ? 'us' : 'jis'
    saveSettings({ labelMode })
    return labelMode
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

  ipcMain.handle(IPC.windowGetMode, () => windows.mode)

  ipcMain.handle(IPC.windowToggleMode, () => {
    windows.toggleMode()
    return windows.mode
  })

  ipcMain.handle(IPC.windowSetOverlayOpacity, (_event, value: unknown) =>
    windows.setOverlayOpacity(isFiniteNumber(value) ? value : Number.NaN)
  )

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
}
