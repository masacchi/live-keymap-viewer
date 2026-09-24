/**
 * Windows 用のインストーラー(セットアップ exe)を作る。
 *
 *   npm run installer:win                          # package:win してから作る
 *   node scripts/installer-win.mjs --out <exe>     # 置き場所を変える(CI で使う)
 *
 * 先に `npm run package:win` で dist/win32-x64 を作っておくこと(installer:win は両方やる)。
 * 中身は scripts/installer-win.nsi。
 *
 * NSIS を使うのは、Linux の makensis が Windows のインストーラーをそのまま作れるから。
 * package-win.mjs と同じく wine も Windows も要らず、npm の依存も増えない。
 * makensis はコンテナ(.devcontainer)に入っている。npm run installer:win はコンテナの中で動かす。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'dist', 'win32-x64')

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
// exe のバージョン情報は数字 4 つしか受け付けない。1.2.3-beta.1 なら 1.2.3.0 にする
const numbers = version.split(/[-+]/)[0].split('.')
const versionWin = [0, 1, 2, 3].map((i) => numbers[i] ?? '0').join('.')

const outIndex = process.argv.indexOf('--out')
const out =
  outIndex === -1
    ? join(ROOT, 'dist', `LiveKeymapViewer-${version}-win-x64-setup.exe`)
    : resolve(process.argv[outIndex + 1] ?? fail('--out の後に出力先を書くこと'))

if (!existsSync(join(SOURCE, 'LiveKeymapViewer.exe'))) {
  fail('dist/win32-x64 が無い。先に `npm run package:win` を実行すること')
}
try {
  execFileSync('makensis', ['-VERSION'], { stdio: 'ignore' })
} catch {
  fail('makensis(NSIS)が見つからない。コンテナの中で動かすこと(npm run installer:win)')
}

await mkdir(dirname(out), { recursive: true })
console.log(`インストーラーを作成中(${version})…`)
execFileSync(
  'makensis',
  [
    '-V2',
    '-INPUTCHARSET',
    'UTF8',
    `-DVERSION=${version}`,
    `-DVERSION_WIN=${versionWin}`,
    `-DSOURCE_DIR=${SOURCE}`,
    `-DICON=${join(ROOT, 'assets', 'icon.ico')}`,
    `-DOUT_FILE=${out}`,
    join(ROOT, 'scripts', 'installer-win.nsi')
  ],
  { stdio: 'inherit' }
)
console.log(`\n完成: ${relative(ROOT, out)}`)
