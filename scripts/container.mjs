/**
 * コマンドを開発用のコンテナ(.devcontainer)の中で動かす。
 *
 *   node scripts/container.mjs <コマンド> [引数…]
 *   npm run container -- bash                      # コンテナの中でシェルを開く
 *
 * Rust のビルド(Windows 向けのクロスビルドを含む)に要るものはコンテナにだけ入れてある。
 * WSL(ホスト)から `npm run package:win` などを打ったときに、ここを通して中で動かす。
 * 一方、Windows 側に置く(deploy-win.mjs)のは WSL からしかできない(powershell.exe を呼ぶ)。
 *
 * すでにコンテナの中(devcontainer で開いている)や CI では、そのまま動かす。
 * イメージの名前は Dockerfile の中身から決め、無ければ作る(Dockerfile を直したら作り直される)。
 * 使うのは podman。Docker なら CONTAINER_ENGINE=docker。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEVCONTAINER = join(ROOT, '.devcontainer')

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`\n✗ ${command} を動かせなかった: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('使い方: node scripts/container.mjs <コマンド> [引数…]')
  process.exit(1)
}

// コンテナの中(Dockerfile で立てている)と CI(ツールを直に入れている)では、そのまま動かす
if (process.env.LKV_DEVCONTAINER === '1' || process.env.CI) {
  process.exit(run(command, args))
}

const engine = process.env.CONTAINER_ENGINE ?? 'podman'
const hash = createHash('sha256')
  .update(readFileSync(join(DEVCONTAINER, 'Dockerfile')))
  .digest('hex')
  .slice(0, 12)
const image = `lkv-dev:${hash}`

if (spawnSync(engine, ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
  console.log(`開発用のイメージ ${image} を作る(初回だけ数分かかる)…`)
  const status = run(engine, [
    'build',
    '-t',
    image,
    '-f',
    join(DEVCONTAINER, 'Dockerfile'),
    DEVCONTAINER
  ])
  if (status !== 0) process.exit(status)
}

const user =
  engine === 'podman'
    ? // ホストの自分の uid をコンテナの ubuntu(uid 1000)に合わせる(devcontainer.json と同じ)
      ['--userns=keep-id']
    : [`--user=${process.getuid()}:${process.getgid()}`]
const cwd = process.cwd().startsWith(ROOT) ? process.cwd() : ROOT
process.exit(
  run(engine, [
    'run',
    '--rm',
    ...(process.stdin.isTTY ? ['-it'] : []),
    ...user,
    // ホストと同じパスに置く。ビルドの出力や、エラーに出るパスがそのまま通じるように
    `--volume=${ROOT}:${ROOT}`,
    `--workdir=${cwd}`,
    // crate と、cargo-xwin が落としてくる MSVC の CRT / Windows SDK は作り直しても残す
    '--volume=lkv-cargo-registry:/home/ubuntu/.cargo/registry',
    '--volume=lkv-xwin-cache:/home/ubuntu/.cache/cargo-xwin',
    image,
    command,
    ...args
  ])
)
