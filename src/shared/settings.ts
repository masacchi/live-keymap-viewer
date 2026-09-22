/**
 * 設定の型・既定値・検証。electron に依存しないので単体テストできる。
 *
 * 設定ファイル(userData/settings.json)は人が手で直すこともあるし、古い版の
 * アプリが書いたものが残っていることもある。読み込んだ値は信用せず、
 * 項目ごとに検証して、ダメなものだけ既定値に戻す。
 */

export type WindowMode = 'normal' | 'overlay'
export type LabelMode = 'jis' | 'us'
/** ノブの割り当てを、キーの図の上と下のどちらに並べるか。 */
export type EncoderPlacement = 'top' | 'bottom'

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
  /** オーバーレイで、ベースレイヤーのあいだは図を薄くするか(ふだんの入力の邪魔にならないように)。 */
  overlayAutoFade: boolean
  /** 薄くしたときに残す濃さ(0〜OVERLAY_FADED_OPACITY_MAX)。全体の濃さ(overlayOpacity)に掛かる。 */
  overlayFadedOpacity: number
  /**
   * オーバーレイの後ろの画面をすりガラスのようにぼかすか(Windows 11 のアクリル)。
   * ぼかしの強さは OS が決めるので、入り切りだけ。薄くしているあいだは外す。
   */
  overlayBlur: boolean
  /** ノブの割り当ての置き場所。ノブが左上にあるキーボードなら上の方が見比べやすい。 */
  encoderPlacement: EncoderPlacement
  /** 一度許可した HID デバイス。次回から自動で繋ぐ。 */
  grantedDevices: GrantedDevice[]
  /**
   * レイヤーの名前。キーボードの UID ごとに、レイヤー番号の順に並べる('' は名前なし)。
   * Vial にはレイヤー名が無いので、アプリ側で持つ。
   */
  layerNames: Record<string, string[]>
}

/**
 * renderer から変えてよい項目。設定パネルやオーバーレイの操作パネルから変えるもの。
 * ウィンドウの位置・モード・許可したデバイス・レイヤー名は main が(専用の手順で)書く。
 *
 * 以前は項目ごとに IPC のチャネルがあり、設定を 1 つ足すのに 9 か所ほど触っていた。
 * いまは 1 本(settings:update)で、足すのは Settings・既定値・検証とこの一覧だけでよい。
 */
export const RENDERER_SETTINGS_KEYS = [
  'labelMode',
  'overlayOpacity',
  'overlayAutoFade',
  'overlayFadedOpacity',
  'overlayBlur',
  'encoderPlacement'
] as const satisfies ReadonlyArray<keyof Settings>

export type RendererSettingsKey = (typeof RENDERER_SETTINGS_KEYS)[number]
export type SettingsPatch = Partial<Pick<Settings, RendererSettingsKey>>
/** オーバーレイの見え方の設定(操作パネルと設定パネルの両方で変える)。 */
export type OverlaySettings = Pick<
  Settings,
  'overlayOpacity' | 'overlayAutoFade' | 'overlayFadedOpacity' | 'overlayBlur'
>

/**
 * renderer から来た変更を、変えてよい項目だけに絞る。値そのものの検証は、保存するときの
 * sanitizeSettings に任せる(手で直したファイルと同じ扱い)。
 */
export function pickRendererPatch(value: unknown): SettingsPatch {
  if (!isRecord(value)) return {}
  const patch: Record<string, unknown> = {}
  for (const key of RENDERER_SETTINGS_KEYS) {
    if (key in value) patch[key] = value[key]
  }
  return patch as SettingsPatch
}

export const MIN_WINDOW_WIDTH = 420
export const MIN_WINDOW_HEIGHT = 240
/** これより薄くすると、操作パネルごと見えなくなって戻せなくなる。 */
export const OVERLAY_OPACITY_MIN = 0.2
/**
 * 薄くしたときの濃さの上限。これより濃いと薄くした意味が無い。下限は 0(消える)でよい ―
 * 薄くするのは図だけで、操作パネルは残るので戻せる。
 */
export const OVERLAY_FADED_OPACITY_MAX = 0.8
/** レイヤー名の長さの上限(文字数)。ツールバーやキーの色帯に収まるように。 */
export const LAYER_NAME_MAX_LENGTH = 12
/** 名前を持てるレイヤーの数。Vial の上限(32)に合わせる。 */
export const MAX_LAYERS = 32

export const DEFAULT_BOUNDS: Bounds = { x: 80, y: 80, width: 1180, height: 620 }

export const DEFAULT_SETTINGS: Settings = {
  mode: 'normal',
  labelMode: 'jis',
  normalBounds: DEFAULT_BOUNDS,
  overlayBounds: DEFAULT_BOUNDS,
  overlayOpacity: 0.82,
  overlayAutoFade: true,
  overlayFadedOpacity: 0.2,
  overlayBlur: false,
  encoderPlacement: 'bottom',
  grantedDevices: [],
  layerNames: {}
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

export function clampFadedOpacity(value: unknown): number {
  if (!isFiniteNumber(value)) return DEFAULT_SETTINGS.overlayFadedOpacity
  return Math.min(OVERLAY_FADED_OPACITY_MAX, Math.max(0, value))
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

/** キーボードの UID(64 ビットの 10 進数)か。layerNames のキーにはこれしか使わない。 */
export function isKeyboardUid(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,20}$/.test(value)
}

/** 名前を 1 つ整える。前後の空白を落とし、長すぎれば切る(絵文字などを途中で割らない)。 */
export function sanitizeLayerName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return [...value.trim()].slice(0, LAYER_NAME_MAX_LENGTH).join('')
}

/** 1 台ぶんの名前の並び。末尾の名前なしは落とす。何も残らなければ null。 */
function sanitizeNameList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const names = value.slice(0, MAX_LAYERS).map(sanitizeLayerName)
  while (names.length > 0 && names[names.length - 1] === '') names.pop()
  return names.length > 0 ? names : null
}

function sanitizeLayerNames(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}
  const out: Record<string, string[]> = {}
  for (const [uid, list] of Object.entries(value)) {
    if (!isKeyboardUid(uid)) continue
    const names = sanitizeNameList(list)
    if (names) out[uid] = names
  }
  return out
}

/** 1 つのレイヤーの名前を変えた layerNames を返す(元は変えない)。空にすると名前を消す。 */
export function withLayerName(
  all: Readonly<Record<string, string[]>>,
  uid: string,
  layer: number,
  name: string
): Record<string, string[]> {
  const list = [...(all[uid] ?? [])]
  while (list.length <= layer) list.push('')
  list[layer] = sanitizeLayerName(name)
  const next = { ...all }
  const cleaned = sanitizeNameList(list)
  if (cleaned) next[uid] = cleaned
  else delete next[uid]
  return next
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
    overlayAutoFade: value.overlayAutoFade !== false,
    overlayFadedOpacity: clampFadedOpacity(value.overlayFadedOpacity),
    overlayBlur: value.overlayBlur === true,
    encoderPlacement: value.encoderPlacement === 'top' ? 'top' : 'bottom',
    grantedDevices: sanitizeDevices(value.grantedDevices),
    layerNames: sanitizeLayerNames(value.layerNames)
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
