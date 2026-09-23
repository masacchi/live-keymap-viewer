/** renderer に渡す最小限の IPC。HID そのものは renderer の WebHID で扱う。 */
import { contextBridge, ipcRenderer } from 'electron'
import {
  type HidCandidate,
  IPC,
  type RendererApi,
  type ReportLevel,
  type SettingsPatch
} from '../shared/ipc'

const api: RendererApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  setLayerName: (uid: string, layer: number, name: string) =>
    ipcRenderer.invoke(IPC.settingsSetLayerName, uid, layer, name),
  forgetDevice: (vendorId: number, productId: number) =>
    ipcRenderer.invoke(IPC.settingsForgetDevice, vendorId, productId),

  getMode: () => ipcRenderer.invoke(IPC.windowGetMode),
  toggleMode: () => ipcRenderer.invoke(IPC.windowToggleMode),
  setOverlayBlurActive: (active: boolean) =>
    ipcRenderer.send(IPC.windowSetOverlayBlurActive, active),

  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send(IPC.windowSetIgnoreMouse, ignore),
  // ドラッグ中に毎フレーム飛ぶので invoke ではなく send
  moveBy: (dx: number, dy: number) => ipcRenderer.send(IPC.windowMoveBy, dx, dy),
  resizeBy: (dw: number, dh: number) => ipcRenderer.send(IPC.windowResizeBy, dw, dh),

  onChooseDevice: (handler: (devices: HidCandidate[]) => void) => {
    const listener = (_event: unknown, devices: HidCandidate[]): void => handler(devices)
    ipcRenderer.on(IPC.hidChooseDevice, listener)
    return () => {
      ipcRenderer.removeListener(IPC.hidChooseDevice, listener)
    }
  },
  chooseDevice: (deviceId: string | null) => ipcRenderer.send(IPC.hidDeviceChosen, deviceId),

  onReleaseHid: (handler: () => void) => {
    const listener = (): void => handler()
    ipcRenderer.on(IPC.hidRelease, listener)
    return () => {
      ipcRenderer.removeListener(IPC.hidRelease, listener)
    }
  },
  hidReleased: () => ipcRenderer.send(IPC.hidReleased),

  report: (level: ReportLevel, message: string, detail?: string) =>
    ipcRenderer.send(IPC.logReport, level, message, detail)
}

contextBridge.exposeInMainWorld('api', api)
