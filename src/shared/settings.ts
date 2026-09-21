/**
 * 設定の型・既定値・検証。electron に依存しないので単体テストできる。
 *
 * 設定ファイル(userData/settings.json)は人が手で直すこともあるし、古い版の
 * アプリが書いたものが残っていることもある。読み込んだ値は信用せず、
 * 項目ごとに検証して、ダメなものだけ既定値に戻す。
 */

export type WindowMode = 'normal' | 'overlay'
export type LabelMode = 'jis' | 'us'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface GrantedDevice {
  vendorId: number
  productId: number
  /** WebHID のデバイス名。人が見て分かるように持っておく。 */
  name?: string
}

export interface Settings {
  mode: WindowMode
  labelMode: LabelMode
  normalBounds: Bounds
  overlayBounds: Bounds
  /** オーバーレイの不透明度(OVERLAY_OPACITY_MIN〜1)。 */
  overlayOpacity: number
  /** 一度許可した HID デバイス。次回から自動で繋ぐ。 */
  grantedDevices: GrantedDevice[]
}

export const MIN_WINDOW_WIDTH = 420
export const MIN_WINDOW_HEIGHT = 240
/** これより薄くすると、操作パネルごと見えなくなって戻せなくなる。 */
export const OVERLAY_OPACITY_MIN = 0.2

export const DEFAULT_BOUNDS: Bounds = { x: 80, y: 80, width: 1180, height: 620 }

export const DEFAULT_SETTINGS: Settings = {
  mode: 'normal',
  labelMode: 'jis',
  normalBounds: DEFAULT_BOUNDS,
  overlayBounds: DEFAULT_BOUNDS,
  overlayOpacity: 0.82,
  grantedDevices: []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clampOpacity(value: unknown): number {
  if (!isFiniteNumber(value)) return DEFAULT_SETTINGS.overlayOpacity
  return Math.min(1, Math.max(OVERLAY_OPACITY_MIN, value))
}

/** 数値として壊れていないか、最小サイズを満たすか。ダメなら null。 */
export function sanitizeBounds(value: unknown): Bounds | null {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value
  if (![x, y, width, height].every(isFiniteNumber)) return null
  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(width as number)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(height as number))
  }
}

function sanitizeDevices(value: unknown): GrantedDevice[] {
  if (!Array.isArray(value)) return []
  const out: GrantedDevice[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const { vendorId, productId, name } = item
    if (!Number.isInteger(vendorId) || !Number.isInteger(productId)) continue
    out.push({
      vendorId: vendorId as number,
      productId: productId as number,
      ...(typeof name === 'string' ? { name } : {})
    })
  }
  return out
}

/** 何が入っていても、使える Settings にして返す。 */
export function sanitizeSettings(raw: unknown): Settings {
  const value = isRecord(raw) ? raw : {}
  return {
    mode: value.mode === 'overlay' ? 'overlay' : 'normal',
    labelMode: value.labelMode === 'us' ? 'us' : 'jis',
    normalBounds: sanitizeBounds(value.normalBounds) ?? DEFAULT_SETTINGS.normalBounds,
    overlayBounds: sanitizeBounds(value.overlayBounds) ?? DEFAULT_SETTINGS.overlayBounds,
    overlayOpacity: clampOpacity(value.overlayOpacity),
    grantedDevices: sanitizeDevices(value.grantedDevices)
  }
}

/**
 * ウィンドウがどの画面にも十分に見えていなければ、主画面の中央に移す。
 *
 * モニターを外したあとに起動すると、保存した位置が画面の外になることがある。
 * オーバーレイはクリックが透過するので、そうなると設定ファイルを手で直すしか
 * なくなる。タイトルバー相当(上端 40px ほど)が見えていれば良しとする。
 */
export function ensureOnScreen(bounds: Bounds, workAreas: readonly Bounds[]): Bounds {
  const GRIP = 40
  const visible = workAreas.some((area) => {
    const left = Math.max(bounds.x, area.x)
    const right = Math.min(bounds.x + bounds.width, area.x + area.width)
    const top = Math.max(bounds.y, area.y)
    const bottom = Math.min(bounds.y + GRIP, area.y + area.height)
    return right - left >= GRIP && bottom - top >= GRIP / 2
  })
  if (visible || workAreas.length === 0) return bounds

  const primary = workAreas[0]
  const width = Math.min(bounds.width, primary.width)
  const height = Math.min(bounds.height, primary.height)
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height
  }
}
