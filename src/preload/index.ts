/** renderer に渡す最小限の IPC。HID そのものは renderer の WebHID で扱う。 */
import { contextBridge, ipcRenderer } from 'electron'
import type { HidCandidate, LabelMode, RendererApi, Settings, WindowMode } from '../shared/ipc'

const api: RendererApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
  setLabelMode: (mode: LabelMode) => ipcRenderer.invoke('settings:set-label-mode', mode),

  getMode: () => ipcRenderer.invoke('window:get-mode'),
  setMode: (mode: WindowMode) => ipcRenderer.invoke('window:set-mode', mode),
  toggleMode: () => ipcRenderer.invoke('window:toggle-mode'),
  setOverlayOpacity: (value: number) =>
    ipcRenderer.invoke('window:set-overlay-opacity', value),

  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.send('window:set-ignore-mouse', ignore),
  // ドラッグ中に毎フレーム飛ぶので invoke ではなく send
  moveBy: (dx: number, dy: number) => ipcRenderer.send('window:move-by', dx, dy),
  resizeBy: (dw: number, dh: number) => ipcRenderer.send('window:resize-by', dw, dh),

  onChooseDevice: (handler: (devices: HidCandidate[]) => void) => {
    const listener = (_event: unknown, devices: HidCandidate[]): void => handler(devices)
    ipcRenderer.on('hid:choose-device', listener)
    return () => {
      ipcRenderer.removeListener('hid:choose-device', listener)
    }
  },
  chooseDevice: (deviceId: string | null) => ipcRenderer.send('hid:device-chosen', deviceId)
}

contextBridge.exposeInMainWorld('api', api)
