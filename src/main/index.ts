/**
 * メインプロセスの入口。起動と終了の段取りだけを持つ。
 *
 *   windows.ts … 通常ウィンドウ / クリック透過オーバーレイの作り分けと切り替え
 *   hid.ts     … WebHID の許可(HID そのものは renderer で扱う)
 *   ipc.ts     … renderer からの要求の受け口
 *   settings.ts … userData/settings.json の読み書き
 *   log.ts     … userData/log.txt(実機で何が起きたかを残す)
 */
import { app, globalShortcut } from 'electron'
import { HidPermissions } from './hid'
import { registerIpc } from './ipc'
import { installLogging, log } from './log'
import { WindowManager } from './windows'

/** 通常ウィンドウ ⇄ オーバーレイの切り替え。オーバーレイ中の最後の逃げ道でもある。 */
const TOGGLE_SHORTCUT = 'Control+Alt+K'

const windows = new WindowManager()
const hid = new HidPermissions(windows)

app.whenReady().then(() => {
  // いちばん先に入れる。これより前に転んだものは記録できない
  installLogging()
  hid.install()
  registerIpc(windows, hid)
  windows.open()

  if (!globalShortcut.register(TOGGLE_SHORTCUT, () => windows.toggleMode())) {
    log('warn', `グローバルショートカット ${TOGGLE_SHORTCUT} を登録できなかった`)
  }

  app.on('activate', () => windows.reopenIfClosed())
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
