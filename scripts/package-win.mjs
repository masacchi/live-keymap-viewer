/**
 * Windows版のexeを作る。Linuxからcargo-xwinでクロスビルドする。
 *
 *   npm run package:win      # WSLから打てば、コンテナの中で動く(scripts/container.mjs)
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

// 画面のビルド(型チェックとvite build)はtauri.conf.jsonのbeforeBuildCommandが先に走らせる
execFileSync(
  join(ROOT, 'node_modules', '.bin', 'tauri'),
  ['build', '--runner', 'cargo-xwin', '--target', TARGET, '--no-bundle'],
  { cwd: ROOT, stdio: 'inherit' }
)

const built = join(ROOT, 'src-tauri', 'target', TARGET, 'release', 'live-keymap-viewer.exe')
if (!existsSync(built)) throw new Error(`できているはずのexeが無い: ${built}`)

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })
const exe = join(OUT_DIR, EXE_NAME)
copyFileSync(built, exe)

const megabytes = (statSync(exe).size / 1024 / 1024).toFixed(1)
console.log(`\n完成: ${relative(ROOT, exe)}(${megabytes} MB)`)
