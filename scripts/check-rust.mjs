/**
 * Rust の検査(整形・clippy・テスト)。`npm run check:rust` で、コンテナの中で動く。
 *
 * clippy は Linux 向けと Windows 向けの両方にかける。Windows でしか使わないコード
 * (後ろのぼかしなど)は `#[cfg(windows)]` の中にあり、Linux 向けだけでは見られないため。
 * テストは Linux で動かす(Windows の exe はコンテナでは動かせない)。
 */

import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CRATE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src-tauri')
const STRICT = ['--all-targets', '--', '-D', 'warnings']

for (const args of [
  ['fmt', '--check'],
  ['clippy', ...STRICT],
  ['xwin', 'clippy', '--target', 'x86_64-pc-windows-msvc', ...STRICT],
  ['test', '--quiet']
]) {
  console.log(`\n> cargo ${args.join(' ')}`)
  const { status } = spawnSync('cargo', args, { cwd: CRATE, stdio: 'inherit' })
  if (status !== 0) process.exit(status ?? 1)
}
