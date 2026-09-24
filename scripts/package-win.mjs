/**
 * Windows 版の exe を作る。Linux から cargo-xwin でクロスビルドする。
 *
 *   npm run package:win      # WSL から打てば、コンテナの中で動く(scripts/container.mjs)
 *
 * できたものは dist/win32-x64/LiveKeymapViewer.exe に置く。deploy-win.mjs と
 * installer-win.mjs はそこから取る。
 *
 * Tauri の exe は 1 つで完結する。画面は Windows に入っている WebView2 で描くので、
 * Electron のころのように Chromium 一式(DLL・pak・locales)を横に置く必要は無い。
 * アイコンとバージョン情報もビルドのときに exe に入る(Electron のころは rcedit が要り、
 * Linux からだと wine が要るので入れていなかった)。
 *
 * Tauri のインストーラー作り(bundle)は使わない(tauri.conf.json の bundle.active: false)。
 * インストーラーは scripts/installer-win.nsi を使い続ける ― 入れる場所や「起動中なら止めずに
 * 断る」などの方針をそのまま保つため。
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = 'x86_64-pc-windows-msvc'
const OUT_DIR = join(ROOT, 'dist', 'win32-x64')
/** Windows のエクスプローラに出る実行ファイル名。 */
const EXE_NAME = 'LiveKeymapViewer.exe'

// 画面のビルド(型チェックと vite build)は tauri.conf.json の beforeBuildCommand が先に走らせる
execFileSync(
  join(ROOT, 'node_modules', '.bin', 'tauri'),
  ['build', '--runner', 'cargo-xwin', '--target', TARGET, '--no-bundle'],
  { cwd: ROOT, stdio: 'inherit' }
)

const built = join(ROOT, 'src-tauri', 'target', TARGET, 'release', 'live-keymap-viewer.exe')
if (!existsSync(built)) throw new Error(`できているはずの exe が無い: ${built}`)

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })
const exe = join(OUT_DIR, EXE_NAME)
copyFileSync(built, exe)

const megabytes = (statSync(exe).size / 1024 / 1024).toFixed(1)
console.log(`\n完成: ${relative(ROOT, exe)}(${megabytes} MB)`)
