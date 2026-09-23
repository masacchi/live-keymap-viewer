/**
 * 設定の読み書き(userData/settings.json)。小さいので外部ライブラリは使わない。
 * 値の検証は shared/settings.ts の sanitizeSettings に任せる。
 *
 * **ディスクへの書き込みはまとめる。** 設定はスライダーからも来る ― つまみを 1 回動かすと
 * 十数回飛んでくる。そのたびに同期で書いていたので、main プロセスが細かく詰まっていた。
 * main が詰まると WebHID の往復も返らない(HID の入出力は main を通る)ので、
 * 濃さを動かしているあいだキーボードの応答が途切れていた。
 * 読み書きの見え方は変えない(保存した値はその場でメモリに載るので、次の loadSettings で読める)。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { type GrantedDevice, type Settings, sanitizeSettings } from '../shared/settings'
import { log } from './log'

/** ディスクへの書き込みをまとめる間隔。 */
const FLUSH_DELAY_MS = 400

let cached: Settings | null = null
/** まだディスクに書いていない変更があるか。 */
let unsaved = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  if (cached) return cached
  let raw: unknown = null
  try {
    raw = JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    // 無い・壊れている → 既定値で始める
  }
  cached = sanitizeSettings(raw)
  return cached
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = sanitizeSettings({ ...loadSettings(), ...patch })
  cached = next
  unsaved = true
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushSettings()
    }, FLUSH_DELAY_MS)
  }
  return next
}

/**
 * 溜めていた変更をディスクに書く。終了時にも呼ぶ(最後の 400ms ぶんを落とさないため)。
 * 書けなくてもアプリは止めない ― 設定が 1 回保存されないだけなので、記録して次に任せる。
 */
export function flushSettings(): void {
  if (!unsaved || !cached) return
  unsaved = false
  try {
    const path = settingsPath()
    mkdirSync(dirname(path), { recursive: true })
    // 書き込み途中で落ちても壊れたファイルが残らないよう、別名に書いてから差し替える
    const temp = `${path}.tmp`
    writeFileSync(temp, `${JSON.stringify(cached, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    log('warn', '設定を保存できなかった', error)
  }
}

export function rememberDevice(device: GrantedDevice): void {
  const settings = loadSettings()
  if (isDeviceGranted(device.vendorId, device.productId)) return
  saveSettings({ grantedDevices: [...settings.grantedDevices, device] })
}

export function isDeviceGranted(vendorId: number, productId: number): boolean {
  return loadSettings().grantedDevices.some(
    (d) => d.vendorId === vendorId && d.productId === productId
  )
}
