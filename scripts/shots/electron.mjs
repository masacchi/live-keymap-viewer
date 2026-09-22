/**
 * 撮影の Electron 側(run.mjs から起動する)。
 *
 *   electron electron.mjs shoot normal|overlay <出力先>
 *   electron electron.mjs compare <前> <後>
 *
 * モックに繋ぎ、図のキーをクリックして押下を作り、場面ごとに撮る。キーは <title> の文字
 * (「Space / 長押しで L2 / raw …」の先頭)で探し、押したときの位置で離す(押すと表示が変わるので)。
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeImage } from 'electron'

const WIDTH = 1180
const HEIGHT = 620
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const log = (...args) => console.error('[shots]', ...args)

/** 1 つのページを操作する道具。 */
function pageOf(win, out) {
  const js = (code) => win.webContents.executeJavaScript(code)
  let titles = []
  const page = {
    js,
    async shot(name) {
      await sleep(400)
      const image = await win.webContents.capturePage()
      writeFileSync(join(out, `${name}.png`), image.toPNG())
      log(name)
    },
    /** ボタンを文字で探して押す(先頭一致)。 */
    click: (text) =>
      js(`(() => {
        const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))
        if (!b) throw new Error('ボタンが無い: ' + ${JSON.stringify(text)})
        b.click()
      })()`),
    clickSelector: (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`),
    /** いまの図のキーの並び(<title> の文字)を覚える。キーを押す前に呼ぶ。 */
    async readKeys() {
      titles = await js(`[...document.querySelectorAll('g.key title')].map((t) => t.textContent)`)
    },
    /** キーを押す / 離す(モックはクリックで押したままになり、もう一度で離す)。 */
    async toggleKey(name) {
      const index = titles.findIndex((title) => title.startsWith(`${name} /`))
      if (index < 0) throw new Error(`キーが無い: ${name}`)
      await js(
        `document.querySelectorAll('g.key')[${index}].dispatchEvent(new MouseEvent('click', { bubbles: true }))`
      )
    },
    async hold(name, shotName) {
      await page.toggleKey(name)
      await sleep(600) // 長押しの確定(200ms)を待つ
      await page.shot(shotName)
      await page.toggleKey(name)
      await sleep(300)
    },
    /** 要素の真ん中にポインタを動かす(乗せたときの表示を撮る)。 */
    async pointAt(code) {
      const { x, y } = await js(`(() => {
        const r = (${code}).getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      })()`)
      win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    },
    pointAway: () => win.webContents.sendInputEvent({ type: 'mouseMove', x: 600, y: 600 }),
    escape: () => win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }),
    closePopover: () =>
      js(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`),
    size: (width, height) => win.setSize(width, height)
  }
  return page
}

/** モックに繋ぎ、Tab と Q を押し続けてアンロックする。途中も撮る。 */
async function connectAndUnlock(page, prefix) {
  await page.click('モックで試す')
  await sleep(1500)
  await page.readKeys()
  await page.shot(`${prefix}-unlocking`)
  await page.toggleKey('Tab')
  await page.toggleKey('Q')
  await sleep(3000)
  await page.shot(`${prefix}-unlocking-progress`)
  await sleep(9000) // モックは 200ms ごとに 50 から数える
  await page.toggleKey('Tab')
  await page.toggleKey('Q')
  await sleep(800)
  await page.readKeys()
}

const toolbarButton = (text) =>
  `[...document.querySelectorAll('header button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`

/** 通常ウィンドウの場面。 */
async function normalScenes(page) {
  await page.shot('01-idle')
  await connectAndUnlock(page, '02')
  await page.shot('03-base')
  await page.hold('BS', '04-hold-l1')
  await page.hold('Space', '05-hold-l2')
  await page.hold('Del', '06-hold-l3')
  await page.hold('`', '07-hold-l4')
  await page.hold('Shift', '08-shift')

  await page.pointAt(toolbarButton('L2'))
  await page.shot('09-hover-l2')
  page.pointAway()
  await page.js(`${toolbarButton('L3')}.click()`)
  await page.shot('10-pinned-l3')
  page.escape()
  await sleep(200)

  await page.clickSelector('header [aria-haspopup=menu]')
  await page.shot('11-device-menu')
  page.escape()
  await sleep(200)

  await page.clickSelector('[title="記号の出し方"]')
  await page.shot('12-symbols')
  await page.js(
    `[...document.querySelectorAll('[role=dialog] li button')].find((b) => b.textContent.startsWith('@')).click()`
  )
  await page.shot('13-symbol-at')
  page.escape()
  await sleep(200)

  await page.clickSelector('[title="設定"]')
  await page.shot('14-settings')
  await page.js(`document.querySelector('[role=dialog] > div').scrollTop = 10000`)
  await page.shot('14b-settings-bottom')
  await page.click('図の上')
  await page.closePopover()
  await page.shot('15-knob-top')
  await page.clickSelector('[title="設定"]')
  await page.click('図の下')
  await page.closePopover()

  await page.click('US')
  await page.shot('16-us')
  await page.click('JIS')

  page.size(760, 420)
  await page.shot('17-narrow')
  page.size(560, 300)
  await page.shot('18-min')
  page.size(1600, 900)
  await page.shot('19-wide')
}

/** オーバーレイの場面。背景は色を付けて、透けているのが分かるようにする。 */
async function overlayScenes(page) {
  await page.shot('50-overlay-idle')
  await connectAndUnlock(page, '51-overlay')
  await sleep(1200) // 薄くなるのを待つ
  await page.shot('52-overlay-faded')
  await page.toggleKey('Space')
  await sleep(600)
  await page.shot('53-overlay-l2')
  await page.toggleKey('Space')
  await sleep(300)
  await page.pointAt(`document.querySelector('[data-interactive]')`)
  await page.shot('54-overlay-panel')
}

async function shoot(mode, out) {
  process.env.SHOTS_WINDOW_MODE = mode
  const overlay = mode === 'overlay'
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    backgroundColor: overlay ? '#5a7a9a' : '#121518',
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      sandbox: false,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url))
    }
  })
  // Windows のときだけ出る欄(後ろのぼかし)も撮る
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} (Windows NT 10.0)`)
  await win.loadURL(process.env.SHOTS_URL)
  // 動きを止めて、撮るたびに同じ絵にする(アンロックの破線や記号の点滅が撮った瞬間で変わると、
  // --compare で毎回差が出て、本当の変化が埋もれる)
  await win.webContents.insertCSS(
    '*, *::before, *::after { animation: none !important; transition: none !important }'
  )
  win.setSize(WIDTH, HEIGHT) // 画面の大きさによっては最初の大きさが縮められる
  await sleep(800)
  const page = pageOf(win, out)
  await (overlay ? overlayScenes(page) : normalScenes(page))
}

/** 同じ名前の PNG を画素で比べる。 */
function compare(before, after) {
  let changed = 0
  for (const name of readdirSync(after)
    .filter((file) => file.endsWith('.png'))
    .sort()) {
    const path = join(before, name)
    if (!existsSync(path)) {
      console.log(`${name}: 新しい`)
      continue
    }
    const a = nativeImage.createFromPath(path)
    const b = nativeImage.createFromPath(join(after, name))
    const [sa, sb] = [a.getSize(), b.getSize()]
    if (sa.width !== sb.width || sa.height !== sb.height) {
      console.log(`${name}: 大きさが違う`)
      changed++
      continue
    }
    const [pa, pb] = [a.toBitmap(), b.toBitmap()]
    let pixels = 0
    for (let i = 0; i < pa.length; i += 4) {
      if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) pixels++
    }
    console.log(`${name}: ${pixels === 0 ? '同じ' : `${pixels} 画素ちがう`}`)
    if (pixels > 0) changed++
  }
  console.log(changed === 0 ? 'すべて同じ' : `${changed} 枚ちがう`)
}

app.whenReady().then(async () => {
  const [command, ...args] = process.argv.slice(2).filter((arg) => !arg.endsWith('electron.mjs'))
  try {
    if (command === 'shoot') await shoot(args[0], args[1])
    else if (command === 'compare') compare(args[0], args[1])
    else throw new Error(`知らない指示: ${command}`)
    app.quit()
  } catch (error) {
    log(String(error?.stack ?? error))
    app.exit(1)
  }
})
