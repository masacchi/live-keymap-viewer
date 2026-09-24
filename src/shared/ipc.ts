/**
 * 画面と、それを動かす側(Tauri の Rust: src-tauri/src/commands.rs)との約束。
 *
 * 画面は `window.api`(RendererApi)だけを通して外と話す。Tauri への繋ぎは platform/tauri.ts。
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

/** 画面がログに残せる段。警告は Rust の側だけが使う。 */
export type ReportLevel = 'info' | 'error'

/** どのビルドが動いているか。設定パネルの隅に出す。 */
export interface AppInfo {
  version: string
  /** 画面を描いているものの名前と版(「WebView2 153.0.…」など)。 */
  runtime: string
  /** ビルドした時刻(ISO)。dev では空。 */
  buildTime: string
  /** 診断用のログの置き場所(設定と同じフォルダの log.txt)。 */
  logPath: string
}

/**
 * アプリの更新の状態(src-tauri/src/updater.rs の UpdateStatus)。
 * 更新はインストーラーで入れたときだけ使える。開発中や deploy:win で置いた exe は unsupported。
 */
export type UpdateStatus =
  | { kind: 'unsupported' }
  | { kind: 'latest'; current: string }
  | { kind: 'available'; current: string; version: string }

/** 繋ぐキーボードの候補が複数あったときに、選ばせるために並べるもの(hid/nativeHid.ts)。 */
export interface HidCandidate {
  deviceId: string
  name: string
  vendorId: number
  productId: number
}

/** 画面が外(Tauri の Rust)に頼めること。画面が使うものだけを置く。 */
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
   * 一度許可したキーボードを忘れる(次の起動で自動では繋がなくなる)。VID / PID で指定する。
   * 残った並びを返す。いま繋いでいる接続はそのまま。
   */
  forgetDevice(vendorId: number, productId: number): Promise<GrantedDevice[]>

  getMode(): Promise<WindowMode>
  toggleMode(): Promise<WindowMode>
  /**
   * いま図を濃く出しているか。薄くしているあいだは、ぼかしを外して後ろの画面を読めるようにする。
   * 薄くするかどうかは画面が決めている(キーの押下を見ている)ので、画面から伝える。
   */
  setOverlayBlurActive(active: boolean): void

  /**
   * オーバーレイのクリック透過を切り替える。
   *
   * オーバーレイは既定でクリックを透過させるので、そのままではボタンが押せない。
   * 画面の側でポインタが操作パネルの上に来たときだけ透過を切る
   * (透過中は Rust がカーソルの位置を送ってくるので、mousemove として届く ― platform/tauri.ts)。
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
   * モードを切り替えるとウィンドウごと作り直すので、新しいウィンドウの画面が
   * 同じキーボードを開きに来る。raw HID の応答は同じデバイスを開いている全員に配られ、
   * Vial コマンド(0xFE)は応答を照合できないので、両方が話していると新しい方の
   * 読み込みが壊れる。手放したら hidReleased() で返事をする(Rust はそれを待って作る)。
   */
  onReleaseHid(handler: () => void): () => void
  hidReleased(): void

  /**
   * 画面側の出来事をログ(log.txt)に残す。
   * 配布ビルドでは DevTools を開けないので、実機で何が起きたかはこれでしか分からない。
   * 残すのはまれにしか起きない区切りだけ(例外・接続が切れた理由・応答待ちからの復帰)。
   */
  report(level: ReportLevel, message: string, detail?: string): void
  /** ログ(log.txt)を OS の既定のアプリで開く。 */
  openLog(): void

  /**
   * 新しい版があるかを見る(GitHub のリリース)。force でなければ、少し前に確かめた結果を使う
   * ― モードを切り替えるたびにウィンドウごと作り直すので、そのたびに問い合わせないように。
   */
  checkForUpdate(force: boolean): Promise<UpdateStatus>
  /** 新しい版を落として入れ替え、起動し直す。うまくいけばアプリが終わる。失敗したら reject。 */
  applyUpdate(): Promise<void>
}
