/**
 * 画面とRust側(src-tauri/src/commands.rs)とのやり取りの型。
 *
 * 画面は`window.api`(RendererApi)だけを通してRust側を呼ぶ。Tauriとの橋渡しはplatform/tauri.ts。
 */

import type { GrantedDevice, Settings, SettingsPatch, WindowMode } from './settings'

export type {
  Bounds,
  GrantedDevice,
  LabelMode,
  Settings,
  SettingsPatch,
  WindowMode
} from './settings'

/** 画面がログに残せるレベル。warnはRust側だけが使う。 */
export type ReportLevel = 'info' | 'error'

/** どのビルドが動いているか。設定パネルの隅に出す。 */
export interface AppInfo {
  version: string
  /** 画面を描いているものの名前と版(「WebView2 153.0.…」など)。 */
  runtime: string
  /** ビルドした時刻(ISO)。devでは空。 */
  buildTime: string
  /** 診断用のログの置き場所(設定と同じフォルダのlog.txt)。 */
  logPath: string
}

/**
 * アプリの更新の状態(src-tauri/src/updater.rsのUpdateStatus)。
 * 更新はインストーラーで入れたときだけ使える。開発中やdeploy:winで置いたexeはunsupported。
 */
export type UpdateStatus =
  | { kind: 'unsupported' }
  | { kind: 'latest'; current: string }
  | { kind: 'available'; current: string; version: string }

/** 接続するキーボードの候補が複数あったときに、選択画面に並べるもの(hid/nativeHid.ts)。 */
export interface HidCandidate {
  deviceId: string
  name: string
  vendorId: number
  productId: number
}

/** 画面からRust側に頼めること。画面が使うものだけを置く。 */
export interface RendererApi {
  /** 版・ビルド時刻・ログの置き場所。設定パネルに出す。 */
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  /**
   * 設定を変える。変えてよい項目(RENDERER_SETTINGS_KEYS)だけを受け付け、値は検証してから保存し、
   * 保存した設定をまるごと返す(範囲外の値は丸められているので、返ってきた方を使う)。
   * 濃さやぼかしのようにウィンドウに効くものは、その場で反映する。
   */
  updateSettings(patch: SettingsPatch): Promise<Settings>
  /**
   * キーボード(UID)のレイヤーに名前を付ける。空文字で名前を消す。
   * 長すぎる名前は切って保存し、そのキーボードの名前の並びを返す。
   */
  setLayerName(uid: string, layer: number, name: string): Promise<string[]>
  /**
   * 一度許可したキーボードを忘れる(次の起動から自動では接続しない)。VID / PIDで指定する。
   * 残った並びを返す。いま繋いでいる接続はそのまま。
   */
  forgetDevice(vendorId: number, productId: number): Promise<GrantedDevice[]>

  getMode(): Promise<WindowMode>
  toggleMode(): Promise<WindowMode>
  /**
   * いま図を濃く表示しているかを伝える。薄くしているあいだは、ぼかしを外して後ろの画面を読めるようにする。
   * 薄くするかどうかは画面が決めている(キーの押下を見ている)ので、画面から伝える。
   */
  setOverlayBlurActive(active: boolean): void

  /**
   * オーバーレイのクリック透過を切り替える。
   *
   * オーバーレイは既定でクリックを透過させるので、そのままではボタンが押せない。
   * 画面の側でポインタが操作パネルの上に来たときだけ透過を切る
   * (透過中はRustがカーソルの位置を送ってくるので、mousemoveとして届く。platform/tauri.ts)。
   */
  setIgnoreMouseEvents(ignore: boolean): void
  /** ウィンドウを相対移動する。オーバーレイの移動つまみから使う。 */
  moveBy(dx: number, dy: number): void
  /** ウィンドウの大きさを相対変更する。 */
  resizeBy(dw: number, dh: number): void

  /** 選択画面に候補を出すときのハンドラを登録する。戻り値を呼ぶと解除。 */
  onChooseDevice(handler: (devices: HidCandidate[]) => void): () => void
  chooseDevice(deviceId: string | null): void

  /**
   * キーボードを解放するよう頼まれたときのハンドラを登録する。戻り値を呼ぶと解除。
   *
   * モードを切り替えるとウィンドウごと作り直すので、新しいウィンドウの画面が
   * 同じキーボードを開きに来る。raw HIDの応答は同じデバイスを開いている全員に配られ、
   * Vialコマンド(0xFE)は応答を照合できないので、両方が話していると新しい方の
   * 読み込みが壊れる。解放したらhidReleased()で知らせる(Rustはそれを待ってから新しいウィンドウを作る)。
   */
  onReleaseHid(handler: () => void): () => void
  hidReleased(): void

  /**
   * 画面で起きたことをログ(log.txt)に残す。
   * 配布ビルドではDevToolsを開けないので、実機で何が起きたかはこれでしか分からない。
   * 残すのはまれにしか起きない出来事だけ(例外・接続が切れた理由・応答待ちからの復帰)。
   */
  report(level: ReportLevel, message: string, detail?: string): void
  /** ログ(log.txt)をOSの既定のアプリで開く。 */
  openLog(): void

  /**
   * 新しい版があるかを確認する(GitHubのリリース)。forceでなければ、少し前に確認した結果を使う。
   * モードを切り替えるたびにウィンドウごと作り直すので、そのたびに問い合わせないように。
   */
  checkForUpdate(force: boolean): Promise<UpdateStatus>
  /** 新しい版をダウンロードして入れ替え、起動し直す。成功するとアプリが終了する。失敗したらreject。 */
  applyUpdate(): Promise<void>
}
