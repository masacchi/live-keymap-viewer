/**
 * Windows のインストーラーと、更新の包みを作る(Velopack の vpk)。
 *
 *   npm run installer:win                        # package:win してから作る(コンテナの中で動く)
 *   node scripts/pack-win.mjs --version 0.1.0-abc1234   # 版を変える(CI のリリースでないビルド)
 *
 * 先に `npm run package:win` で dist/win32-x64 を作っておくこと(installer:win は両方やる)。
 * dist/releases/ にできるもの:
 *
 *   live-keymap-viewer-win-Setup.exe       インストーラー。ワンクリックで入れて起動する
 *   live-keymap-viewer-<版>-full.nupkg     更新の中身
 *   releases.win.json など                  更新の目録。アプリはこれを読んで新しい版を知る
 *
 * Velopack のポータブル版(zip)は作らない。展開したところの起動用 exe に表示名がそのまま付き
 * (`Live Keymap Viewer.exe`)、パスに半角スペースが入るため。ポータブル版は dist/win32-x64 の
 * exe をそのまま使う(自分では更新しない。更新はインストーラーで入れたものだけ)。
 *
 * GitHub のリリースに載せるのは CI(`vpk upload github`。.github/workflows/build-windows.yml)。
 * vpk は Linux から Windows 向けの包みを作れる(`[win]` の指定)。wine も Windows も要らない。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'dist', 'win32-x64')
const OUT_DIR = join(ROOT, 'dist', 'releases')
const EXE_NAME = 'LiveKeymapViewer.exe'

/**
 * パッケージの ID。入れる場所(%LOCALAPPDATA%\live-keymap-viewer)にもなるので、スペースを入れない。
 * **変えない。** 変えると別のアプリとして扱われ、入っているものが更新されなくなる。
 */
const PACK_ID = 'live-keymap-viewer'
/** スタートメニュー・デスクトップのショートカットと「アプリと機能」に出る名前。 */
const PACK_TITLE = 'Live Keymap Viewer'

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const versionIndex = process.argv.indexOf('--version')
const version =
  versionIndex === -1
    ? pkg.version
    : (process.argv[versionIndex + 1] ?? fail('--version の後に版を書くこと'))

if (!existsSync(join(SOURCE, EXE_NAME))) {
  fail('dist/win32-x64 が無い。先に `npm run package:win` を実行すること')
}

// 手元では毎回作り直す。前の包みが残っていると、同じ版を作ろうとして vpk が止まる
rmSync(OUT_DIR, { recursive: true, force: true })

console.log(`インストーラーと更新の包みを作成中(${version})…`)
execFileSync(
  'vpk',
  [
    '[win]',
    'pack',
    '--runtime',
    'win-x64',
    '--packId',
    PACK_ID,
    '--packVersion',
    version,
    '--packTitle',
    PACK_TITLE,
    '--packAuthors',
    'masacchi',
    '--packDir',
    SOURCE,
    '--mainExe',
    EXE_NAME,
    '--icon',
    join(ROOT, 'assets', 'icon.ico'),
    '--splashImage',
    join(ROOT, 'assets', 'icon.png'),
    // 画面は WebView2 で描く。Windows 11 には入っているが、無ければ Setup が先に入れる
    '--framework',
    'webview2',
    '--noPortable',
    '--outputDir',
    OUT_DIR
  ],
  { cwd: ROOT, stdio: 'inherit' }
)

console.log('\n完成:')
for (const file of readdirSync(OUT_DIR)) console.log(`  ${relative(ROOT, join(OUT_DIR, file))}`)
