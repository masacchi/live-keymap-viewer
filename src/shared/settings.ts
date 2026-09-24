/**
 * 設定の型・既定値・範囲。画面が表示とスライダーの範囲を決めるのに使う。
 *
 * **検証と保存は Rust の側**(src-tauri/src/settings.rs)。範囲や既定値はそちらにも同じものが
 * あるので、**変えるときは両方を直す。** 画面は Rust が確かめて返した値をそのまま使う。
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
  /** デバイス名。人が見て分かるように持っておく。 */
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
  /**
   * ツールバーのレイヤー一覧で、番号の横に行き方(「BS 長押し」など)を出すか。
   * 既定では出さない ― 常に並べるとツールバーが詰まり、狭いウィンドウでは横に流れてしまう。
   * 出さなくても、チップにポインタを乗せればツールチップで分かる。
   */
  showLayerTriggers: boolean
  /**
   * 長押しと見なすまでの時間(ms)。LT のレイヤーが出るのを表示するのに使う(アプリの推定)。
   * キーボードのファームの設定(tapping term / hold timeout)と合わせる。ずれると、表示だけ
   * 早く / 遅くレイヤーが切り替わる。Tap Dance はキーボードに設定された時間を使う。
   */
  tappingTerm: number
  /** 一度許可した HID デバイス。次回から自動で繋ぐ。 */
  grantedDevices: GrantedDevice[]
  /**
   * レイヤーの名前。キーボードの UID ごとに、レイヤー番号の順に並べる('' は名前なし)。
   * Vial にはレイヤー名が無いので、アプリ側で持つ。
   */
  layerNames: Record<string, string[]>
}

/**
 * 画面から変えてよい項目。設定パネルやオーバーレイの操作パネルから変えるもの。
 * ウィンドウの位置・モード・許可したデバイス・レイヤー名は Rust が(専用の手順で)書く。
 * Rust の側(settings.rs の RENDERER_SETTINGS_KEYS)も同じ一覧で絞る。
 *
 * 設定を 1 つ足すときは、Settings・既定値とこの一覧、それに settings.rs の型・検証・一覧を触る。
 */
export const RENDERER_SETTINGS_KEYS = [
  'labelMode',
  'tappingTerm',
  'overlayOpacity',
  'overlayAutoFade',
  'overlayFadedOpacity',
  'overlayBlur',
  'showLayerTriggers'
] as const satisfies ReadonlyArray<keyof Settings>

export type RendererSettingsKey = (typeof RENDERER_SETTINGS_KEYS)[number]
export type SettingsPatch = Partial<Pick<Settings, RendererSettingsKey>>
/** オーバーレイの見え方の設定(操作パネルと設定パネルの両方で変える)。 */
export type OverlaySettings = Pick<
  Settings,
  'overlayOpacity' | 'overlayAutoFade' | 'overlayFadedOpacity' | 'overlayBlur'
>

/** これより薄くすると、操作パネルごと見えなくなって戻せなくなる。 */
export const OVERLAY_OPACITY_MIN = 0.2
/**
 * 薄くしたときの濃さの上限。これより濃いと薄くした意味が無い。下限は 0(消える)でよい ―
 * 薄くするのは図だけで、操作パネルは残るので戻せる。
 */
export const OVERLAY_FADED_OPACITY_MAX = 0.8
/** 長押しの判定時間の範囲(ms)。QMK の TAPPING_TERM としてふつうに使われる幅。 */
export const TAPPING_TERM_MIN = 100
export const TAPPING_TERM_MAX = 500
/** レイヤー名の長さの上限(文字数)。ツールバーやキーの色帯に収まるように。 */
export const LAYER_NAME_MAX_LENGTH = 12

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
  showLayerTriggers: false,
  // QMK の TAPPING_TERM の既定値(engine/layerState.ts の DEFAULT_TAPPING_TERM と同じ)
  tappingTerm: 200,
  grantedDevices: [],
  layerNames: {}
}
