/**
 * メインプロセスの入口。起動と終了の段取りだけを持つ。
 *
 *   windows.ts … 通常ウィンドウ / クリック透過オーバーレイの作り分けと切り替え
 *   hid.ts     … WebHID の許可(HID そのものは renderer で扱う)
 *   ipc.ts     … renderer からの要求の受け口
 *   settings.ts … userData/settings.json の読み書き
 *   log.ts     … userData/log.txt(実機で何が起きたかを残す)
 */
import { app, globalShortcut, nativeTheme } from 'electron'
import { HidPermissions } from './hid'
import { registerIpc } from './ipc'
import { installLogging, log } from './log'
import { flushSettings } from './settings'
import { WindowManager } from './windows'

/** 通常ウィンドウ ⇄ オーバーレイの切り替え。オーバーレイ中の最後の逃げ道でもある。 */
const TOGGLE_SHORTCUT = 'Control+Alt+K'

const windows = new WindowManager()
const hid = new HidPermissions(windows)

app.whenReady().then(() => {
  // いちばん先に入れる。これより前に転んだものは記録できない
  installLogging()

  // 画面は暗い配色だけで作ってある(styles.css にライトのトークンは無い)。OS が
  // ライトテーマだと、オーバーレイの後ろのぼかし(アクリル)まで**ライトの色味で描かれ**、
  // 図を薄くしたときに白い板が残る ― ぼかしの色味は OS がウィンドウの配色から決めるため。
  // アプリの配色を暗い方に固定して、ぼかしも暗い側で描いてもらう
  nativeTheme.themeSource = 'dark'
  hid.install()
  registerIpc(windows, hid)
  windows.open()

  if (!globalShortcut.register(TOGGLE_SHORTCUT, () => windows.toggleMode())) {
    log('warn', `グローバルショートカット ${TOGGLE_SHORTCUT} を登録できなかった`)
  }

  app.on('activate', () => windows.reopenIfClosed())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  // 設定の書き込みはまとめてあるので、最後のぶんをここで落とさずに書く
  flushSettings()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
