/**
 * package.jsonの版を、src-tauri/Cargo.tomlとCargo.lockに写す。
 *
 *   node scripts/sync-version.mjs
 *
 * `npm version`の途中(package.jsonを書き換えたあと、コミットする前)にpackage.jsonの
 * `version`スクリプトから呼ばれ、写したファイルも同じコミットに入る。
 *
 * アプリの画面やexeに出る版はpackage.jsonから来る(tauri.conf.jsonの`version`)ので、
 * Cargo.tomlの版は表示には効かない。それでもビルドのログやcargoの出力には出るので、
 * 食い違って紛らわしくならないように合わせておく。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** fileの中で、patternに合う最初の1か所の版を書き換える。見つからなければ止める。 */
function replaceVersion(file, pattern) {
  const path = join(ROOT, file)
  const text = readFileSync(path, 'utf8')
  if (!pattern.test(text)) {
    console.error(`\n✗ ${file}の版の場所が見つからない\n`)
    process.exit(1)
  }
  writeFileSync(
    path,
    text.replace(pattern, (_, head) => `${head}"${version}"`)
  )
}

// [package]の直後のname / versionだけを書き換える(依存の版には触らない)
replaceVersion(
  'src-tauri/Cargo.toml',
  /(\[package\]\nname = "live-keymap-viewer"\nversion = )"[^"]*"/
)
replaceVersion('src-tauri/Cargo.lock', /(name = "live-keymap-viewer"\nversion = )"[^"]*"/)
console.log(`Cargo.toml / Cargo.lockの版を${version}にした`)
