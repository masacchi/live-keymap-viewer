/** userData の JSON に置く設定。小さいので外部ライブラリは使わない。 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GrantedDevice, Settings } from '../shared/ipc'

export type { Bounds, GrantedDevice, LabelMode, Settings, WindowMode } from '../shared/ipc'

const DEFAULTS: Settings = {
  mode: 'normal',
  labelMode: 'jis',
  normalBounds: { x: 80, y: 80, width: 1180, height: 620 },
  overlayBounds: { x: 80, y: 80, width: 1180, height: 620 },
  overlayOpacity: 0.82,
  grantedDevices: []
}

let cached: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    cached = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    cached = { ...DEFAULTS }
  }
  return cached
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  cached = next
  const path = settingsPath()
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

export function rememberDevice(device: GrantedDevice): void {
  const settings = loadSettings()
  const known = settings.grantedDevices.some(
    (d) => d.vendorId === device.vendorId && d.productId === device.productId
  )
  if (known) return
  saveSettings({ grantedDevices: [...settings.grantedDevices, device] })
}

export function isDeviceGranted(vendorId: number, productId: number): boolean {
  return loadSettings().grantedDevices.some(
    (d) => d.vendorId === vendorId && d.productId === productId
  )
}
