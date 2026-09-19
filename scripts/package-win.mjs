/**
 * Windows 用の実行ファイル一式を作る。
 *
 *   npm run package:win
 *
 * 本来 electron-builder や @electron/packager を使うところだが、どちらも
 * Windows の exe にアイコンやバージョン情報を書き込むために rcedit を呼び、
 * Linux からだと wine が要る。このアプリは
 *
 *   - ネイティブモジュールを使っていない(HID は renderer の WebHID)
 *   - main / preload は electron と node 標準しか import していない
 *   - xz の WASM は renderer のバンドルに埋め込まれている
 *
 * ので、公式の win32 zip を展開して out/ を resources/app に置き、
 * electron.exe をリネームするだけで動く。wine は要らない。
 */
import { downloadArtifact } from '@electron/get'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARCH = process.argv[2] ?? 'x64' // x64 | arm64
const OUT_DIR = join(ROOT, 'dist', `win32-${ARCH}`)

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const electronVersion = pkg.devDependencies.electron.replace(/^[^0-9]*/, '')
/** Windows のエクスプローラに出る実行ファイル名。 */
const EXE_NAME = 'LiveKeymapViewer.exe'

if (!existsSync(join(ROOT, 'out/main/index.js'))) {
  throw new Error('out/ が無い。先に `npm run build` を実行すること')
}

console.log(`Electron ${electronVersion} (win32-${ARCH}) を取得中…`)
const zip = await downloadArtifact({
  version: electronVersion,
  platform: 'win32',
  arch: ARCH,
  artifactName: 'electron'
})

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })
console.log(`展開中 → ${OUT_DIR}`)
execFileSync('unzip', ['-q', zip, '-d', OUT_DIR], { stdio: 'inherit' })

// 既定の「Electron へようこそ」アプリを外し、自前のものを置く
await rm(join(OUT_DIR, 'resources/default_app.asar'), { force: true })
const appDir = join(OUT_DIR, 'resources/app')
await mkdir(appDir, { recursive: true })
await cp(join(ROOT, 'out'), join(appDir, 'out'), { recursive: true })
await writeFile(
  join(appDir, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      productName: 'Live Keymap Viewer',
      version: pkg.version,
      description: pkg.description,
      type: 'module',
      main: './out/main/index.js'
    },
    null,
    2
  )}\n`,
  'utf8'
)

await rename(join(OUT_DIR, 'electron.exe'), join(OUT_DIR, EXE_NAME))

// exe 単体では動かない。icudtl.dat や resources/app が隣に無いと
// 「Invalid file descriptor to ICU data received」で落ちる。
console.log(`\n完成: ${OUT_DIR}`)
console.log('')
console.log('  ⚠ exe 単体では動かない。フォルダごとコピーすること。')
console.log('')
console.log(`    cp -r ${OUT_DIR.replace(ROOT + '/', '')} /mnt/c/Users/$USER/Desktop/LiveKeymapViewer`)
console.log('')
console.log(`  コピーしたフォルダの中の ${EXE_NAME} を実行する。`)
