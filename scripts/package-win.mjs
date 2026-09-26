/**
 * Windows版のexeを作る。Linuxからcargo-xwinでクロスビルドする。
 *
 *   npm run package:win      # WSLから打てば、コンテナの中で動く(scripts/container.mjs)
 *   npm run package:win -- --dev --version 0.1.1-dev.5   # 開発版(CIがmainへのpushで作る)
 *
 * できたものはdist/win32-x64/LiveKeymapViewer.exeに置く。deploy-win.mjsとpack-win.mjsは
 * そこから取る。
 *
 * exeは1つで完結する。画面はWindowsに入っているWebView2で描くので、ほかのファイルを横に
 * 置く必要は無い。アイコンとバージョン情報もビルドのときにexeに入る。
 *
 * Tauriのインストーラー作り(bundle)は使わない(tauri.conf.jsonのbundle.active: false)。
 * インストーラーはVelopackで作る(pack-win.mjs)。Tauri標準のNSISは製品名から入れる場所を決め、
 * パスに半角スペースが入るため。
 *
 * `--dev`は開発版にする。リリース版と1台に並べて入れられるように、設定の置き場所・更新の元・
 * ウィンドウの名前(src-tauri/src/channel.rs。環境変数`LKV_DEV`で切り替わる)と、WebView2の
 * データの置き場所(Tauriのidentifierから決まる)を分ける。
 * `--version`は画面とexeに出る版を変える(既定はpackage.jsonの版)。開発版はビルドのたびに版が
 * 変わるので、どのビルドか分かるようにそれを渡す。
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = 'x86_64-pc-windows-msvc'
const OUT_DIR = join(ROOT, 'dist', 'win32-x64')
/** Windowsのエクスプローラに出る実行ファイル名。 */
const EXE_NAME = 'LiveKeymapViewer.exe'
/** tauri.conf.jsonのidentifier。開発版はこれに`-dev`を付ける。 */
const IDENTIFIER = 'io.github.masacchi.live-keymap-viewer'

const dev = process.argv.includes('--dev')
const versionIndex = process.argv.indexOf('--version')
const version = versionIndex === -1 ? undefined : process.argv[versionIndex + 1]
if (versionIndex !== -1 && !version) {
  console.error('\n✗ --versionの後に版を書くこと\n')
  process.exit(1)
}

// tauri.conf.jsonに重ねる設定。何も変えないときは渡さない
const config = {
  ...(dev && { identifier: `${IDENTIFIER}-dev` }),
  ...(version && { version })
}

// LKV_DEVはRustがビルドのときに読む(channel.rs。変わればcargoがビルドし直す)。
// リリース版は、外に残っていても必ず外す
const env = { ...process.env }
if (dev) env.LKV_DEV = '1'
else delete env.LKV_DEV

// 画面のビルド(型チェックとvite build)はtauri.conf.jsonのbeforeBuildCommandが先に走らせる
execFileSync(
  join(ROOT, 'node_modules', '.bin', 'tauri'),
  [
    'build',
    '--runner',
    'cargo-xwin',
    '--target',
    TARGET,
    '--no-bundle',
    ...(Object.keys(config).length > 0 ? ['--config', JSON.stringify(config)] : [])
  ],
  { cwd: ROOT, stdio: 'inherit', env }
)

const built = join(ROOT, 'src-tauri', 'target', TARGET, 'release', 'live-keymap-viewer.exe')
if (!existsSync(built)) throw new Error(`できているはずのexeが無い: ${built}`)

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })
const exe = join(OUT_DIR, EXE_NAME)
copyFileSync(built, exe)

const megabytes = (statSync(exe).size / 1024 / 1024).toFixed(1)
console.log(`\n完成: ${relative(ROOT, exe)}(${megabytes} MB${dev ? '、開発版' : ''})`)
