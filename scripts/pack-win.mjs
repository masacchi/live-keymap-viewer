/**
 * Windowsのインストーラーと、更新用のパッケージを作る(Velopackのvpk)。
 *
 *   npm run installer:win                        # package:winしてから作る(コンテナの中で動く)
 *   node scripts/pack-win.mjs --version 0.1.0-abc1234   # 版を変える(CIのリリースでないビルド)
 *
 * 先に`npm run package:win`でdist/win32-x64を作っておくこと(installer:winは両方やる)。
 * dist/releases/ にできるもの:
 *
 *   live-keymap-viewer-win-Setup.exe       インストーラー。ワンクリックで入れて起動する
 *   live-keymap-viewer-<版>-full.nupkg     更新用のパッケージ
 *   releases.win.jsonなど                  リリースの一覧。アプリはこれを読んで新しい版を知る
 *
 * Velopackのポータブル版(zip)は作らない。展開したところの起動用exeに表示名がそのまま付き
 * (`Live Keymap Viewer.exe`)、パスに半角スペースが入るため。ポータブル版はdist/win32-x64の
 * exeをそのまま使う(自分では更新しない。更新はインストーラーで入れたものだけ)。
 *
 * GitHubのリリースに載せるのはCI(`vpk upload github`。.github/workflows/build-windows.yml)。
 * vpkはLinuxからWindows向けのパッケージを作れる(`[win]`の指定)。wineもWindowsも要らない。
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
 * パッケージのID。入れる場所(%LOCALAPPDATA%\live-keymap-viewer)にもなるので、スペースを入れない。
 * **変えない。**変えると別のアプリとして扱われ、入っているものが更新されなくなる。
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
    : (process.argv[versionIndex + 1] ?? fail('--versionの後に版を書くこと'))

if (!existsSync(join(SOURCE, EXE_NAME))) {
  fail('dist/win32-x64が無い。先に`npm run package:win`を実行すること')
}

// 手元では毎回作り直す。前のパッケージが残っていると、同じ版を作ろうとしてvpkが止まる
rmSync(OUT_DIR, { recursive: true, force: true })

console.log(`インストーラーと更新用のパッケージを作成中(${version})…`)
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
    // 画面はWebView2で描く。Windows 11には入っているが、無ければSetupが先に入れる
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
