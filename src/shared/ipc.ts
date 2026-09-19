/** main / preload / renderer で共有する型。electron には依存しない。 */

export type WindowMode = 'normal' | 'overlay'
export type LabelMode = 'jis' | 'us'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface GrantedDevice {
  vendorId: number
  productId: number
  name?: string
}

export interface Settings {
  mode: WindowMode
  labelMode: LabelMode
  normalBounds: Bounds
  overlayBounds: Bounds
  overlayOpacity: number
  grantedDevices: GrantedDevice[]
}

/** select-hid-device で候補が複数あったときに renderer へ渡すもの。 */
export interface HidCandidate {
  deviceId: string
  name: string
  vendorId: number
  productId: number
}

/** preload が contextBridge で公開する API。 */
export interface RendererApi {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  setLabelMode(mode: LabelMode): Promise<LabelMode>

  getMode(): Promise<WindowMode>
  setMode(mode: WindowMode): Promise<WindowMode>
  toggleMode(): Promise<WindowMode>
  setOverlayOpacity(value: number): Promise<number>

  /** 候補が飛んできたときのハンドラを登録する。戻り値を呼ぶと解除。 */
  onChooseDevice(handler: (devices: HidCandidate[]) => void): () => void
  chooseDevice(deviceId: string | null): void
}
