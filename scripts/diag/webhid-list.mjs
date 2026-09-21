/**
 * Electron(WebHID)から HID デバイスがどう見えているかを、Windows 上で調べる。
 *
 *   npm run package:win     # 先に dist/win32-x64 を作っておく
 *   npm run diag:webhid
 *
 * dist/win32-x64 の Electron を Windows の %TEMP% に写し、診断用の小さなアプリを載せて
 * ウィンドウを出さずに動かす。`select-hid-device` に渡ってくる一覧を、絞り込み無しと
 * Vial の絞り込み(0xFF60 / 0x61)の 2 通りで出す。**デバイスは開かない。**
 * 終わったら一時フォルダは消す。WSL 専用。
 *
 * アプリの選択ダイアログに何が並ぶか・名前がどう出るかは、これで分かる
 * (BT の Cornix は「不明なデバイス(E118:0001)」になる。docs/BLUETOOTH.md §2.6)。
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE = join(ROOT, 'dist', 'win32-x64')
// 本物と同じ名前だと deploy:win の「起動中か」の判定に引っかかるので変える
const EXE = 'LkvWebHidDiag.exe'

if (!existsSync(join(SOURCE, 'LiveKeymapViewer.exe'))) {
  console.error('dist/win32-x64 が無い。先に `npm run package:win` を実行すること')
  process.exit(1)
}

const winTemp = execFileSync('cmd.exe', ['/c', 'echo %TEMP%'], { cwd: '/mnt/c' }).toString().trim()
const dir = join(execFileSync('wslpath', ['-u', winTemp]).toString().trim(), 'lkv-webhid-diag')

const MAIN = `
const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')
const path = require('path')
const out = path.join(__dirname, '..', '..', 'hid-diag.json')
const result = { electron: process.versions.electron, chrome: process.versions.chrome, select: [], errors: [] }
const save = () => fs.writeFileSync(out, JSON.stringify(result, null, 2))
setTimeout(() => { result.errors.push('timeout'); save(); app.exit(1) }, 25000)
app.whenReady().then(async () => {
  const ses = session.defaultSession
  ses.setPermissionCheckHandler(() => true)
  let label = ''
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    result.select.push({ label, devices: details.deviceList })
    callback()
  })
  const win = new BrowserWindow({ show: false })
  await win.loadFile(path.join(__dirname, 'index.html'))
  const js = (code) => win.webContents.executeJavaScript(code, true)
  try {
    label = 'all'
    await js('navigator.hid.requestDevice({ filters: [] })')
    label = 'vial'
    await js('navigator.hid.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] })')
  } catch (e) {
    result.errors.push(String((e && e.stack) || e))
  }
  save()
  app.quit()
})
`

rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
console.log(`組み立て中 → ${dir}`)
cpSync(SOURCE, dir, {
  recursive: true,
  filter: (src) => !relative(SOURCE, src).split(sep).join('/').startsWith('resources/app')
})
renameSync(join(dir, 'LiveKeymapViewer.exe'), join(dir, EXE))
const app = join(dir, 'resources', 'app')
mkdirSync(app, { recursive: true })
writeFileSync(join(app, 'package.json'), '{ "name": "lkv-webhid-diag", "main": "main.js" }\n')
writeFileSync(join(app, 'index.html'), '<!doctype html><meta charset="utf-8"><p>diag</p>\n')
writeFileSync(join(app, 'main.js'), MAIN)

try {
  execFileSync(join(dir, EXE), [], { cwd: dir, timeout: 40000, stdio: 'ignore' })
  const result = JSON.parse(readFileSync(join(dir, 'hid-diag.json'), 'utf8'))
  console.log(`Electron ${result.electron} / Chrome ${result.chrome}`)
  if (result.errors.length > 0) console.log('errors:', result.errors)
  for (const { label, devices } of result.select) {
    const title = label === 'all' ? '絞り込み無し(全 HID)' : 'Vial の絞り込み(0xFF60 / 0x61)'
    console.log(`\n=== ${title}: ${devices.length} 台`)
    for (const d of devices) {
      const id = `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`
      const cols = (d.collections ?? [])
        .map(
          (c) =>
            `${(c.usagePage ?? 0).toString(16).padStart(4, '0')}/${(c.usage ?? 0).toString(16)}`
        )
        .join(', ')
      console.log(`  ${id}  ${d.name}  [${cols}]`)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
