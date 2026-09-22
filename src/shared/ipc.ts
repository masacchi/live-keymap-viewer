/** main / preload / renderer で共有する型。electron には依存しない。 */

import type { EncoderPlacement, LabelMode, Settings, WindowMode } from './settings'

export type {
  Bounds,
  EncoderPlacement,
  GrantedDevice,
  LabelMode,
  Settings,
  WindowMode
} from './settings'

/**
 * IPC のチャネル名。main / preload の両方がここを参照する。
 * 文字列を直に書くと、片方だけ直して食い違ったときに気づけないので。
 */
export const IPC = {
  settingsGet: 'settings:get',
  settingsSetLabelMode: 'settings:set-label-mode',
  settingsSetLayerName: 'settings:set-layer-name',
  settingsSetEncoderPlacement: 'settings:set-encoder-placement',
  windowGetMode: 'window:get-mode',
  windowToggleMode: 'window:toggle-mode',
  windowSetOverlayOpacity: 'window:set-overlay-opacity',
  settingsSetOverlayAutoFade: 'settings:set-overlay-auto-fade',
  settingsSetOverlayFadedOpacity: 'settings:set-overlay-faded-opacity',
  windowSetOverlayBlur: 'window:set-overlay-blur',
  windowSetOverlayBlurActive: 'window:set-overlay-blur-active',
  windowSetIgnoreMouse: 'window:set-ignore-mouse',
  windowMoveBy: 'window:move-by',
  windowResizeBy: 'window:resize-by',
  hidChooseDevice: 'hid:choose-device',
  hidDeviceChosen: 'hid:device-chosen'
} as const

/** select-hid-device で候補が複数あったときに renderer へ渡すもの。 */
export interface HidCandidate {
  deviceId: string
  name: string
  vendorId: number
  productId: number
}

/** preload が contextBridge で公開する API。renderer が使うものだけを置く。 */
export interface RendererApi {
  getSettings(): Promise<Settings>
  setLabelMode(mode: LabelMode): Promise<LabelMode>
  /**
   * キーボード(UID)のレイヤーに名前を付ける。空文字で名前を消す。
   * 長すぎる名前は切って保存し、そのキーボードの名前の並びを返す。
   */
  setLayerName(uid: string, layer: number, name: string): Promise<string[]>
  /** ノブの割り当ての置き場所。保存した値を返す。 */
  setEncoderPlacement(placement: EncoderPlacement): Promise<EncoderPlacement>

  getMode(): Promise<WindowMode>
  toggleMode(): Promise<WindowMode>
  /** 範囲外は丸めて保存し、実際に使った値を返す。 */
  setOverlayOpacity(value: number): Promise<number>
  /** オーバーレイで、ベースレイヤーのあいだ図を薄くするか。保存した値を返す。 */
  setOverlayAutoFade(on: boolean): Promise<boolean>
  /** 薄くしたときに残す濃さ。範囲外は丸めて保存し、実際に使った値を返す。 */
  setOverlayFadedOpacity(value: number): Promise<number>
  /** オーバーレイの後ろの画面をぼかすか(Windows 11 のアクリル)。保存した値を返す。 */
  setOverlayBlur(on: boolean): Promise<boolean>
  /**
   * いま図を濃く出しているか。薄くしているあいだは、ぼかしを外して後ろの画面を読めるようにする。
   * 薄くするかどうかは renderer が決めている(キーの押下を見ている)ので、renderer から伝える。
   */
  setOverlayBlurActive(active: boolean): void

  /**
   * オーバーレイのクリック透過を切り替える。
   *
   * オーバーレイは既定でクリックを透過させるので、そのままではボタンが押せない。
   * renderer 側でポインタが操作パネルの上に来たときだけ透過を切る
   * (`forward: true` にしてあるので、透過中でも mousemove だけは届く)。
   */
  setIgnoreMouseEvents(ignore: boolean): void
  /** ウィンドウを相対移動する。オーバーレイのつまみから使う。 */
  moveBy(dx: number, dy: number): void
  /** ウィンドウの大きさを相対変更する。 */
  resizeBy(dw: number, dh: number): void

  /** 候補が飛んできたときのハンドラを登録する。戻り値を呼ぶと解除。 */
  onChooseDevice(handler: (devices: HidCandidate[]) => void): () => void
  chooseDevice(deviceId: string | null): void
}
