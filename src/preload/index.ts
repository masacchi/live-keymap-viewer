/** renderer に渡す最小限の IPC。HID そのものは renderer の WebHID で扱う。 */
import { contextBridge, ipcRenderer } from 'electron'
import { type HidCandidate, IPC, type LabelMode, type RendererApi } from '../shared/ipc'

const api: RendererApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setLabelMode: (mode: LabelMode) => ipcRenderer.invoke(IPC.settingsSetLabelMode, mode),
  setLayerName: (uid: string, layer: number, name: string) =>
    ipcRenderer.invoke(IPC.settingsSetLayerName, uid, layer, name),

  getMode: () => ipcRenderer.invoke(IPC.windowGetMode),
  toggleMode: () => ipcRenderer.invoke(IPC.windowToggleMode),
  setOverlayOpacity: (value: number) => ipcRenderer.invoke(IPC.windowSetOverlayOpacity, value),
  setOverlayAutoFade: (on: boolean) => ipcRenderer.invoke(IPC.settingsSetOverlayAutoFade, on),

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
  chooseDevice: (deviceId: string | null) => ipcRenderer.send(IPC.hidDeviceChosen, deviceId)
}

contextBridge.exposeInMainWorld('api', api)
