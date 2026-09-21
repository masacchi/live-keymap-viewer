/**
 * 設定の読み書き(userData/settings.json)。小さいので外部ライブラリは使わない。
 * 値の検証は shared/settings.ts の sanitizeSettings に任せる。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { type GrantedDevice, type Settings, sanitizeSettings } from '../shared/settings'

let cached: Settings | null = null

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
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  // 書き込み途中で落ちても壊れたファイルが残らないよう、別名に書いてから差し替える
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
  return next
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
