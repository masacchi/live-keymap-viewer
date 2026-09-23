/**
 * 画面側の出来事を main のログ(userData/log.txt)に残す。
 *
 * 配布ビルドでは DevTools を開けないので、実機で何が起きたかはこれでしか分からない。
 * 残すのは**まれにしか起きない区切り**だけ ― 例外、接続が切れた理由、応答待ちからの復帰。
 * ポーリングのように毎秒起きることは書かない(ログが埋まって肝心なものが流れる)。
 */

export function reportError(message: string, detail?: string): void {
  window.api?.report('error', message, detail)
}

export function reportInfo(message: string): void {
  window.api?.report('info', message)
}
