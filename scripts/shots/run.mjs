/**
 * モックを動かして、状態ごとに画面を撮る。
 *
 *   npm run shots                               … .shots/latest に撮る
 *   npm run shots -- --out .shots/before        … 撮る先を変える
 *   npm run shots -- --compare .shots/before    … 撮ったあと、前の結果と画素で比べる
 *
 * WSL からは実機が見えないので、見た目の変更はこれで確かめる。リファクタの前後で撮って
 * --compare すれば、見た目が変わっていないことを画素単位で確かめられる。撮るあいだは
 * アニメーションと transition を止めるので、同じコードなら毎回同じ絵になる。
 *
 * 画面は出さない(オフスクリーンで描いて撮る)。Windows 側で動いているアプリには触らない。
 * 撮る場面は electron.mjs の SCENES。
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import electronPath from 'electron'
import { createServer } from 'vite'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: '.shots/latest' },
    compare: { type: 'string' }
  }
})
const out = resolve(values.out)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// npm run dev が 5173 を使っていても撮れるように、空いている番号にずらす(vite.config.ts は固定)
const server = await createServer({
  clearScreen: false,
  logLevel: 'error',
  server: { strictPort: false }
})
await server.listen()
const url = server.resolvedUrls?.local[0]
if (!url) throw new Error('開発サーバーの URL が取れなかった')

/** Electron を 1 回動かす。ツールの中では ELECTRON_RUN_AS_NODE が立っていることがあるので外す。 */
function electron(args) {
  const env = { ...process.env, SHOTS_URL: url }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((done, fail) => {
    const child = spawn(electronPath, [resolve('scripts/shots/electron.mjs'), ...args], {
      stdio: ['ignore', 'inherit', 'pipe'],
      env
    })
    // GPU や D-Bus の警告は WSL では毎回出て読めなくなるので、こちらの出したものだけ通す
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split('\n'))
        if (line.startsWith('[shots]')) console.error(line)
    })
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`electron が ${code} で終わった`))
    )
  })
}

try {
  await electron(['shoot', 'normal', out])
  await electron(['shoot', 'overlay', out])
  console.log(`撮った: ${out}`)
  if (values.compare) await electron(['compare', resolve(values.compare), out])
} finally {
  await server.close()
}
