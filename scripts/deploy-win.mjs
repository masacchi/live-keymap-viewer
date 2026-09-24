/**
 * WSLから、Windows側にビルド済みのアプリを置く。
 *
 *   npm run deploy:win                      # 既定: Windowsのデスクトップ/LiveKeymapViewer
 *   npm run deploy:win -- --dest /mnt/c/Tools/LiveKeymapViewer
 *
 * 先に`npm run package:win`でdist/win32-x64を作っておくこと(deploy:winは両方やる)。
 * これはWSLで動かす(powershell.exeを呼ぶので、コンテナの中からは動かない)。
 *
 * 気をつけていること:
 *
 * 1. **起動中なら止めずに断る。**動いているアプリのexeはWindowsがロックして
 *    いて消せない。勝手に終了させると、確認中の画面を落とすことになる。
 *    見るのは**置き場所のexeが動いているか**(名前だけでは見ない)。別の場所に置いた版
 *    (たとえばElectron版)が動いていても、置き場所が違えば差し替えられる。
 * 2. **置き場所を壊さない。**以前は`rm -rf`してからコピーしていたため、ロックされた
 *    ファイルでrmが途中で止まり、icudtl.datなどだけが消えて起動できない状態が残った。
 *    いまは隣に`.new`として完全に置いてから、名前の付け替えで差し替える。
 *    付け替えに失敗しても、元のフォルダはそのまま残る。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'dist', 'win32-x64')
const EXE_NAME = 'LiveKeymapViewer.exe'
/** これが揃っていなければ起動しない。Tauriのexeは1つで完結する。 */
const REQUIRED = [EXE_NAME]

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

/** Windowsのコマンドを/mnt/cから呼ぶ(UNCパスの警告を避ける)。 */
function windows(command, args) {
  return execFileSync(command, args, { cwd: '/mnt/c', stdio: ['ignore', 'pipe', 'ignore'] })
}

function defaultDestination() {
  // OneDriveにリダイレクトされていることがあるので、実際の場所をWindowsに聞く
  const desktop = windows('powershell.exe', [
    '-NoProfile',
    '-Command',
    "[Environment]::GetFolderPath('Desktop')"
  ])
    .toString('utf8')
    .trim()
  if (!desktop) fail('Windows のデスクトップの場所が分からなかった。--dest で指定すること')
  const wsl = execFileSync('wslpath', ['-u', desktop]).toString('utf8').trim()
  return join(wsl, 'LiveKeymapViewer')
}

/** 置き場所のexeが動いているか。 */
function isRunning(dest) {
  const exe = execFileSync('wslpath', ['-w', join(dest, EXE_NAME)])
    .toString('utf8')
    .trim()
  const name = EXE_NAME.replace(/\.exe$/, '')
  // パスは'を重ねてPowerShellの文字列に埋める。-eqは大文字小文字を区別しない
  const script =
    `@(Get-Process -Name '${name}' -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.Path -eq '${exe.replaceAll("'", "''")}' }).Count`
  const out = windows('powershell.exe', ['-NoProfile', '-Command', script])
  return Number.parseInt(out.toString('utf8').trim(), 10) > 0
}

function parseDestination() {
  const index = process.argv.indexOf('--dest')
  if (index === -1) return defaultDestination()
  const value = process.argv[index + 1]
  if (!value) fail('--dest の後に置き場所を書くこと')
  return resolve(value)
}

// --- ここから---

if (!existsSync(join(SOURCE, EXE_NAME))) {
  fail('dist/win32-x64 が無い。先に `npm run package:win` を実行すること')
}

const dest = parseDestination()
const staging = `${dest}.new`
const backup = `${dest}.old`

if (isRunning(dest)) {
  fail(
    `${EXE_NAME} が起動中なので差し替えられない。\n` +
      '  アプリを閉じてから、もう一度実行すること(このスクリプトは勝手に終了させない)。'
  )
}

console.log(`コピー中 → ${staging}`)
rmSync(staging, { recursive: true, force: true })
cpSync(SOURCE, staging, { recursive: true })

const missing = REQUIRED.filter((file) => !existsSync(join(staging, file)))
if (missing.length > 0) {
  rmSync(staging, { recursive: true, force: true })
  fail(`コピーが不完全だった(足りない: ${missing.join(', ')})。元の置き場所は触っていない`)
}

// 名前の付け替えで差し替える。途中で失敗しても元のフォルダは残る
rmSync(backup, { recursive: true, force: true })
if (existsSync(dest)) {
  try {
    renameSync(dest, backup)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    fail(
      `元のフォルダを退避できなかった(${error.code ?? error.message})。\n` +
        '  エクスプローラーでフォルダを開いていたり、アプリが残っていないか確かめること。\n' +
        '  元の置き場所はそのまま残してある。'
    )
  }
}
renameSync(staging, dest)
rmSync(backup, { recursive: true, force: true })

console.log(`\n✓ 置いた: ${dest}`)
console.log(`  ${EXE_NAME} を実行する。`)
