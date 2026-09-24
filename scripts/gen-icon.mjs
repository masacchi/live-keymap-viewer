/**
 * アプリのアイコン(assets/icon.svg)から、icon.png(256px)とicon.ico(16〜256px)を作る。
 *
 *   npm run gen:icon
 *
 * できたものはコミットする。**手で直さない**(SVGを直して作り直す)。
 *
 * SVGを描けるものが要るが、依存を増やさないよう、開発用に入っているElectronの画面のcanvasで
 * 描く(Nodeから起動すると、自分をElectronで動かし直す)。画面は出さない。
 * ICOは書式が単純なので自前で組み立てる。各サイズはPNGを詰めず、昔ながらの32bit BMPで入れる
 * (古いツールでも読めるように)。
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets')
/** ICOに入れる大きさ。Windowsが表示倍率(100〜250%)やアイコンの表示の大きさに合わせて選ぶ。 */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

// Electronの中ではawaitしない。ESMのエントリーのトップレベルのawaitが終わるまで
// readyが来ないので、renderの中でwhenReadyを待つと止まったままになる
if (process.versions.electron) void render()
else await launch()

/** Nodeから: このファイルをElectronで動かす。ELECTRON_RUN_AS_NODEが立っているとNodeとして動くので外す。 */
async function launch() {
  const { default: electronPath } = await import('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise((done, fail) => {
    const child = spawn(electronPath, [fileURLToPath(import.meta.url)], {
      stdio: ['ignore', 'inherit', 'pipe'],
      env
    })
    // GPUやD-Busの警告はWSLでは毎回出て読めなくなるので、こちらの出したものだけ通す
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split('\n'))
        if (line.startsWith('[gen-icon]')) console.error(line)
    })
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`electron が ${code} で終わった`))
    )
  })
}

/** Electronの中で: SVGを大きさごとにcanvasへ描き、PNGとICOに書き出す。 */
async function render() {
  const { app, BrowserWindow } = await import('electron')
  try {
    await app.whenReady()
    const win = new BrowserWindow({ show: false })
    await win.loadURL('data:text/html,<meta charset="utf-8">')
    const svg = `data:image/svg+xml;base64,${readFileSync(join(ASSETS, 'icon.svg')).toString('base64')}`
    // 大きさごとにSVGから描き直す(256pxを縮めるより、小さいサイズの輪郭がにじまない)
    const images = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image()
      img.src = ${JSON.stringify(svg)}
      await img.decode()
      const out = {}
      for (const size of ${JSON.stringify(SIZES)}) {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const g = canvas.getContext('2d')
        g.drawImage(img, 0, 0, size, size)
        out[size] = {
          rgba: Array.from(g.getImageData(0, 0, size, size).data),
          png: canvas.toDataURL('image/png')
        }
      }
      return out
    })()`)

    const png = Buffer.from(images[256].png.split(',')[1], 'base64')
    writeFileSync(join(ASSETS, 'icon.png'), png)
    writeFileSync(join(ASSETS, 'icon.ico'), ico(SIZES.map((size) => ({ size, ...images[size] }))))
    console.error(
      `[gen-icon] assets/icon.png(256px)と assets/icon.ico(${SIZES.join(' / ')}px)を作った`
    )
    app.exit(0)
  } catch (error) {
    console.error('[gen-icon]', error)
    app.exit(1)
  }
}

/**
 * ICOを組み立てる。先頭6バイトの見出し、画像ごとに16バイトの目次、そのあとに画像を並べる。
 * 大きさの欄は1バイトなので、256は0と書く決まり。
 */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // 予約
  header.writeUInt16LE(1, 2) // 1 = アイコン(2はカーソル)
  header.writeUInt16LE(images.length, 4)

  const entries = []
  const bodies = []
  let offset = header.length + 16 * images.length
  for (const { size, rgba } of images) {
    const body = bitmap(size, rgba)
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 幅
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // 高さ
    entry.writeUInt16LE(1, 4) // プレーン数
    entry.writeUInt16LE(32, 6) // 1画素のビット数
    entry.writeUInt32LE(body.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += body.length
    entries.push(entry)
    bodies.push(body)
  }
  return Buffer.concat([header, ...entries, ...bodies])
}

/**
 * ICOの中の1枚(32bit BMP)。BITMAPINFOHEADERのあとに、下の行からBGRAの画素と、
 * 透明のマスク(1bit、行ごとに4バイト境界まで詰める)を並べる。高さは色とマスクの2枚ぶん書く。
 * 32bitなら透明は画素のアルファで決まるが、マスクも入れておかないと古い読み手が四角く塗る。
 */
function bitmap(size, rgba) {
  const maskStride = Math.ceil(size / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // この見出しの大きさ
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12) // プレーン数
  header.writeUInt16LE(32, 14) // 1画素のビット数
  header.writeUInt32LE(0, 16) // 圧縮なし
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20)

  const pixels = Buffer.alloc(size * size * 4)
  const mask = Buffer.alloc(maskStride * size)
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y // BMPは下の行から並べる
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = (row * size + x) * 4
      pixels[to] = rgba[from + 2] // B
      pixels[to + 1] = rgba[from + 1] // G
      pixels[to + 2] = rgba[from] // R
      pixels[to + 3] = rgba[from + 3] // A
      if (rgba[from + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, pixels, mask])
}
