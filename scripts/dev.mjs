/**
 * 開発用の起動。
 *
 *   npm run dev
 *
 * electron-vite の dev がしていたことを、Vite の公開 API(createServer / build)だけで行う。
 * electron-vite の安定版が Vite 8 に対応していなかったので外した(docs/ARCHITECTURE.md)。
 *
 *   renderer … Vite の開発サーバー。ホットリロードが効く
 *   main     … 変更のたびにビルドし直し、Electron を再起動する
 *   preload  … 変更のたびにビルドし直し、画面を再読み込みする(preload は読み込みのたびに走る)
 *
 * Electron には開発サーバーの URL を ELECTRON_RENDERER_URL で渡す(src/main/windows.ts)。
 * Electron のウィンドウを閉じると、このスクリプトも終わる。
 */

import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { build, createServer } from 'vite'

// main のビルドのログや Electron の出力を、HMR のたびに消されないようにする
const server = await createServer({ clearScreen: false })
await server.listen()
server.printUrls()
const rendererUrl = server.resolvedUrls?.local[0]
if (!rendererUrl) throw new Error('開発サーバーの URL が取れなかった')

/** @type {import('node:child_process').ChildProcess | null} */
let electron = null

function startElectron() {
  const child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl }
  })
  child.on('exit', (code) => {
    // 再起動のために止めたときは electron が差し替わっている。閉じられたときだけ全体を終える
    if (electron === child) void shutdown(code ?? 0)
  })
  electron = child
}

function restartElectron() {
  const old = electron
  // 前の再起動で止めている最中。このあと起動するものが最新のビルドを読むので、何もしなくてよい
  if (!old) return
  electron = null
  // 前のプロセスが終わるのを待つ。重なるとグローバルショートカットの登録がぶつかる
  old.once('exit', startElectron)
  old.kill()
}

/** main と preload の両方が一度できあがるまでは Electron を起動しない */
const built = { main: false, preload: false }

/** @param {'main' | 'preload'} name */
function onBuilt(name) {
  const starting = !(built.main && built.preload)
  built[name] = true
  if (!(built.main && built.preload)) return
  if (starting) startElectron()
  else if (name === 'main') restartElectron()
  else server.ws.send({ type: 'full-reload' })
}

/**
 * build.watch を付けると、Vite は監視を始めたところで watcher を返す。
 * @param {'main' | 'preload'} name
 */
function watch(name) {
  return build({
    configFile: `vite.${name}.config.ts`,
    mode: 'development',
    build: { watch: {} },
    // 失敗したビルドでは writeBundle は呼ばれないので、壊れたものでは再起動しない
    plugins: [{ name: 'dev-notify', writeBundle: () => onBuilt(name) }]
  })
}

const watchers = await Promise.all([watch('main'), watch('preload')])

/** @param {number} code */
async function shutdown(code) {
  await Promise.all(watchers.map((w) => w.close()))
  await server.close()
  process.exit(code)
}
