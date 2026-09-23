/** main / preload / renderer で共有する型。electron には依存しない。 */

import type { GrantedDevice, Settings, SettingsPatch, WindowMode } from './settings'

export type {
  Bounds,
  GrantedDevice,
  LabelMode,
  Settings,
  SettingsPatch,
  WindowMode
} from './settings'

/**
 * IPC のチャネル名。main / preload の両方がここを参照する。
 * 文字列を直に書くと、片方だけ直して食い違ったときに気づけないので。
 */
export const IPC = {
  appGetInfo: 'app:get-info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsSetLayerName: 'settings:set-layer-name',
  settingsForgetDevice: 'settings:forget-device',
  windowGetMode: 'window:get-mode',
  windowToggleMode: 'window:toggle-mode',
  windowSetOverlayBlurActive: 'window:set-overlay-blur-active',
  windowSetIgnoreMouse: 'window:set-ignore-mouse',
  windowMoveBy: 'window:move-by',
  windowResizeBy: 'window:resize-by',
  hidChooseDevice: 'hid:choose-device',
  hidDeviceChosen: 'hid:device-chosen',
  hidRelease: 'hid:release',
  hidReleased: 'hid:released',
  logReport: 'log:report',
  logOpen: 'log:open'
} as const

/** renderer がログに残せる段。警告は main だけが使う。 */
export type ReportLevel = 'info' | 'error'

/** どのビルドが動いているか。設定パネルの隅に出す。 */
export interface AppInfo {
  version: string
  electron: string
  /** ビルドした時刻(ISO)。dev では空。 */
  buildTime: string
  /** 診断用のログの置き場所(userData/log.txt)。 */
  logPath: string
}

/** select-hid-device で候補が複数あったときに renderer へ渡すもの。 */
export interface HidCandidate {
  deviceId: string
  name: string
  vendorId: number
  productId: number
}

/** preload が contextBridge で公開する API。renderer が使うものだけを置く。 */
export interface RendererApi {
  /** 版・ビルド時刻・ログの置き場所。設定パネルに出す。 */
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  /**
   * 設定を変える。変えてよい項目(RENDERER_SETTINGS_KEYS)だけを受け付け、値は検証してから保存し、
   * 保存した設定をまるごと返す(範囲外の値は丸められているので、返ってきた方を使う)。
   * 濃さやぼかしのようにウィンドウに効くものは、main がその場で反映する。
   */
  updateSettings(patch: SettingsPatch): Promise<Settings>
  /**
   * キーボード(UID)のレイヤーに名前を付ける。空文字で名前を消す。
   * 長すぎる名前は切って保存し、そのキーボードの名前の並びを返す。
   */
  setLayerName(uid: string, layer: number, name: string): Promise<string[]>
  /**
   * 一度許可したキーボードを忘れる(次の起動で自動では繋がなくなる)。VID / PID で指定する。
   * 残った並びを返す。いま繋いでいる接続はそのまま。
   */
  forgetDevice(vendorId: number, productId: number): Promise<GrantedDevice[]>

  getMode(): Promise<WindowMode>
  toggleMode(): Promise<WindowMode>
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

  /**
   * 「キーボードを手放して」と言われたときのハンドラを登録する。戻り値を呼ぶと解除。
   *
   * モードを切り替えるとウィンドウごと作り直すので、新しいウィンドウの renderer が
   * 同じキーボードを開きに来る。raw HID の応答は同じデバイスを開いている全員に配られ、
   * Vial コマンド(0xFE)は応答を照合できないので、両方が話していると新しい方の
   * 読み込みが壊れる。手放したら hidReleased() で返事をする(main はそれを待って作る)。
   */
  onReleaseHid(handler: () => void): () => void
  hidReleased(): void

  /**
   * 画面側の出来事を main のログ(userData/log.txt)に残す。
   * 配布ビルドでは DevTools を開けないので、実機で何が起きたかはこれでしか分からない。
   * 残すのはまれにしか起きない区切りだけ(例外・接続が切れた理由・応答待ちからの復帰)。
   */
  report(level: ReportLevel, message: string, detail?: string): void
  /** ログ(userData/log.txt)を OS の既定のアプリで開く。 */
  openLog(): void
}
