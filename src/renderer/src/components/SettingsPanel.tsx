/**
 * 設定パネル(ツールバーの「設定」から開く)。
 *
 * - レイヤー名 … ツールバーのレイヤーをダブルクリックしても付けられる
 * - ツールバー … レイヤーの行き方を番号の横に並べるか(既定は出さない。ツールチップには出る)
 * - 長押しの判定時間 … キーボードの設定と合わせる(ずれると表示だけ早く / 遅く切り替わる)
 * - オーバーレイの濃さ・自動フェード・後ろのぼかし … オーバーレイに入らなくても変えられる
 * - 許可したキーボード … 自動で接続するキーボードの一覧と、忘れる操作
 * - このアプリ … 版・ログ・更新
 *
 * 表記(JIS / US)はよく切り替えるので、ここではなくツールバーに置いたまま。
 */
import { type JSX, type KeyboardEvent, type ReactNode, useState } from 'react'
import type { AppInfo } from '../../../shared/ipc'
import {
  DEFAULT_TOGGLE_SHORTCUT,
  LAYER_NAME_MAX_LENGTH,
  OVERLAY_FADED_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  type OverlaySettings,
  type Settings,
  type SettingsPatch,
  TAPPING_TERM_MAX,
  TAPPING_TERM_MIN
} from '../../../shared/settings'
import type { AppUpdate } from '../hooks/useAppUpdate'
import { cn } from '../lib/cn'
import { formatShortcut, isModifierCode, shortcutFromKeyboardEvent } from '../lib/shortcut'
import { layerColor } from '../lib/theme'
import { messages } from '../messages'
import { Button } from './ui/Button'
import { PercentSlider, Slider } from './ui/Slider'

export interface SettingsLayer {
  layer: number
  /** そのレイヤーへの行き方(「Space長押し」)。無ければnull。 */
  how: string | null
}

export interface SettingsPanelProps {
  /** 名前を付けられるレイヤー(中身のあるもの)。キーボードを読み込むまでは空。 */
  layers: readonly SettingsLayer[]
  names: readonly string[]
  /** 名前を付けた(空なら消した)とき。渡さなければ名前の欄は出さない。 */
  onRename?: (layer: number, name: string) => void
  /** いまの設定(このパネルで変える項目)。 */
  settings: Pick<
    Settings,
    'tappingTerm' | 'toggleShortcut' | 'grantedDevices' | 'showLayerTriggers'
  > &
    OverlaySettings
  /**
   * 切り替えのショートカットを登録できているか。ほかのアプリが同じ組み合わせを使っていると
   * falseになるので、別の組み合わせを勧める。
   */
  shortcutRegistered?: boolean
  /**
   * Windowsの起動時に自動で起動するか。取れていなければnull(欄を出さない。ブラウザで開いたときなど)。
   */
  autostart?: boolean | null
  onAutostart?: (enabled: boolean) => void
  onChange: (patch: SettingsPatch) => void
  /**
   * キーボードから読めた長押しの判定時間(ms)。読めていればそちらで判定するので、
   * 「長押しまで」は動かせないようにして、その旨を出す。
   */
  keyboardTappingTerm?: number | null
  /** 許可したキーボードを忘れる。渡さなければ一覧だけ出す(保存できないとき)。 */
  onForgetDevice?: (vendorId: number, productId: number) => void
  /** 後ろのぼかしが使えるか(Windowsのときだけ)。 */
  blurSupported: boolean
  /** どのビルドが動いているか。取れていなければ欄を出さない(ブラウザで開いたとき)。 */
  appInfo?: AppInfo | null
  /** アプリの更新(hooks/useAppUpdate.ts)。渡さなければ欄を出さない。 */
  update?: AppUpdate
  onCheckUpdate?: () => void
  onApplyUpdate?: (version: string) => void
}

/** 更新の状態と、そのとき押せるボタン。 */
function UpdateRow({
  update,
  onCheck,
  onApply
}: {
  update: AppUpdate
  onCheck?: () => void
  onApply?: (version: string) => void
}): JSX.Element {
  const text = messages.settings.update
  if (update.phase === 'unsupported') {
    return <p className="text-2xs text-muted">{text.unsupported}</p>
  }
  const status = {
    idle: '',
    checking: text.checking,
    latest: text.latest,
    available: update.phase === 'available' ? text.available(update.version) : '',
    applying: text.applying,
    failed: text.failed,
    applyFailed: text.applyFailed
  }[update.phase]
  const version = 'version' in update ? update.version : null
  return (
    <div className="flex items-center gap-2">
      {version && (update.phase === 'available' || update.phase === 'applyFailed') ? (
        <Button size="sm" variant="primary" onClick={() => onApply?.(version)}>
          {text.apply}
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={update.phase === 'checking' || update.phase === 'applying'}
          onClick={onCheck}
        >
          {text.check}
        </Button>
      )}
      <span className="min-w-0 flex-1 text-2xs text-muted">{status}</span>
    </div>
  )
}

/** ビルドした時刻(ISO)を「2026-09-23 19:48」の形にする。読めなければ空。 */
function formatBuildTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * 切り替えのショートカット。押すと「キーを押してください」になり、次に押した組み合わせを登録する。
 * Escでやめる。使えない組み合わせ(Ctrl・Alt・Winを含まない)は登録せずに理由を出す。
 */
function ShortcutField({
  value,
  registered,
  onChange
}: {
  value: string
  registered: boolean
  onChange: (shortcut: string) => void
}): JSX.Element {
  const [recording, setRecording] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const text = messages.settings

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!recording) return
    // 押したキーで、ボタンが押されたりパネルが閉じたりしないように
    event.preventDefault()
    event.stopPropagation()
    if (event.code === 'Escape') {
      setRecording(false)
      setInvalid(false)
      return
    }
    if (isModifierCode(event.code)) return // 本体のキーを待つ
    const shortcut = shortcutFromKeyboardEvent(event)
    setInvalid(shortcut === null)
    if (shortcut === null) return
    setRecording(false)
    onChange(shortcut)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-ink">
        <span className="w-20 shrink-0">{text.toggleShortcut}</span>
        <Button
          size="sm"
          onClick={() => setRecording(true)}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
          aria-pressed={recording}
          className={cn('min-w-28 justify-center font-mono', recording && 'ring-2 ring-ink/60')}
        >
          {recording ? text.shortcutRecording : formatShortcut(value)}
        </Button>
        {value !== DEFAULT_TOGGLE_SHORTCUT && (
          <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_TOGGLE_SHORTCUT)}>
            {text.shortcutReset}
          </Button>
        )}
      </div>
      <p className={cn('text-2xs', invalid || !registered ? 'text-warn' : 'text-muted')}>
        {invalid ? text.shortcutInvalid : registered ? text.shortcutHint : text.shortcutTaken}
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="space-y-2 px-2 py-2.5">
      <h2 className="text-2xs font-semibold text-muted">{title}</h2>
      {children}
    </section>
  )
}

export function SettingsPanel({
  layers,
  names,
  onRename,
  settings,
  onChange,
  keyboardTappingTerm = null,
  shortcutRegistered = true,
  autostart = null,
  onAutostart,
  onForgetDevice,
  blurSupported,
  appInfo,
  update,
  onCheckUpdate,
  onApplyUpdate
}: SettingsPanelProps): JSX.Element {
  return (
    // 項目が増えて、既定のウィンドウの高さには収まらない。はみ出す分はパネルの中だけで流す
    <div className="max-h-[calc(100vh-4.5rem)] w-80 divide-y divide-line-soft overflow-y-auto">
      <Section title={messages.settings.layerNames}>
        {onRename && layers.length > 0 ? (
          <>
            <ul className="space-y-1.5">
              {layers.map(({ layer, how }) => (
                <li key={layer} className="flex items-center gap-2">
                  <span
                    className="w-8 shrink-0 rounded-md py-0.5 text-center text-2xs font-bold text-ink-inverse"
                    style={{ backgroundColor: layerColor(layer) }}
                  >
                    L{layer}
                  </span>
                  <input
                    // 保存した名前が変われば欄を作り直す(ツールバーのダブルクリックで変えたときなど)
                    key={names[layer] ?? ''}
                    aria-label={messages.layerStrip.nameLabel(layer)}
                    placeholder={how ?? messages.settings.unnamed}
                    defaultValue={names[layer] ?? ''}
                    maxLength={LAYER_NAME_MAX_LENGTH}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        // パネルを閉じずに、入力だけを元に戻す
                        event.stopPropagation()
                        event.currentTarget.value = names[layer] ?? ''
                        event.currentTarget.blur()
                      }
                    }}
                    onBlur={(event) => {
                      const value = event.currentTarget.value
                      if (value !== (names[layer] ?? '')) onRename(layer, value)
                    }}
                    className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 text-xs text-ink outline-none placeholder:text-muted focus:border-ink/60"
                  />
                </li>
              ))}
            </ul>
            <p className="text-2xs text-muted">{messages.settings.layerNamesHint}</p>
          </>
        ) : (
          <p className="text-2xs text-muted">{messages.settings.connectToName}</p>
        )}
      </Section>

      <Section title={messages.settings.toolbar}>
        <label className="flex items-start gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={settings.showLayerTriggers}
            onChange={(event) => onChange({ showLayerTriggers: event.target.checked })}
            className="mt-0.5 accent-ink"
          />
          <span>
            {messages.settings.showLayerTriggers}
            <span className="block text-2xs text-muted">
              {messages.settings.showLayerTriggersHint}
            </span>
          </span>
        </label>
      </Section>

      <Section title={messages.settings.shortcut}>
        <ShortcutField
          value={settings.toggleShortcut}
          registered={shortcutRegistered}
          onChange={(toggleShortcut) => onChange({ toggleShortcut })}
        />
      </Section>

      <Section title={messages.settings.keys}>
        <Slider
          label={messages.settings.tappingTerm}
          value={settings.tappingTerm}
          min={TAPPING_TERM_MIN}
          max={TAPPING_TERM_MAX}
          step={10}
          format={messages.settings.tappingTermValue}
          onChange={(tappingTerm) => onChange({ tappingTerm })}
          disabled={keyboardTappingTerm != null}
          className="gap-2 text-xs text-ink"
          labelClassName="w-20"
          trackClassName="flex-1"
          valueClassName="w-14"
        />
        <p className="text-2xs text-muted">
          {keyboardTappingTerm != null
            ? messages.settings.tappingTermFromKeyboard(keyboardTappingTerm)
            : messages.settings.tappingTermHint}
        </p>
      </Section>

      <Section title={messages.settings.overlay}>
        <PercentSlider
          label={messages.settings.opacity}
          value={settings.overlayOpacity}
          min={OVERLAY_OPACITY_MIN}
          max={1}
          onChange={(overlayOpacity) => onChange({ overlayOpacity })}
          className="gap-2 text-xs text-ink"
          labelClassName="w-20"
          trackClassName="flex-1"
        />
        <label className="flex items-start gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={settings.overlayAutoFade}
            onChange={(event) => onChange({ overlayAutoFade: event.target.checked })}
            className="mt-0.5 accent-ink"
          />
          <span>
            {messages.settings.autoFade}
            <span className="block text-2xs text-muted">{messages.settings.autoFadeHint}</span>
          </span>
        </label>
        <PercentSlider
          label={messages.settings.fadedOpacity}
          title={messages.settings.fadedOpacityHint}
          value={settings.overlayFadedOpacity}
          min={0}
          max={OVERLAY_FADED_OPACITY_MAX}
          onChange={(overlayFadedOpacity) => onChange({ overlayFadedOpacity })}
          disabled={!settings.overlayAutoFade}
          className="gap-2 pl-5 text-xs text-ink"
          labelClassName="w-15"
          trackClassName="flex-1"
        />
        <label
          className={cn('flex items-start gap-2 text-xs text-ink', !blurSupported && 'opacity-50')}
        >
          <input
            type="checkbox"
            checked={settings.overlayBlur}
            disabled={!blurSupported}
            onChange={(event) => onChange({ overlayBlur: event.target.checked })}
            className="mt-0.5 accent-ink"
          />
          <span>
            {messages.settings.blur}
            <span className="block text-2xs text-muted">
              {blurSupported ? messages.settings.blurHint : messages.settings.blurUnsupported}
            </span>
          </span>
        </label>
        <p className="text-2xs text-muted">{messages.settings.overlayPanelToo}</p>
      </Section>

      <Section title={messages.settings.devices}>
        {settings.grantedDevices.length > 0 ? (
          <>
            <ul className="space-y-1">
              {settings.grantedDevices.map(({ vendorId, productId, name }) => (
                <li key={`${vendorId}:${productId}`} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {name || messages.devicePicker.unnamed}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-muted">
                    {messages.settings.deviceId(vendorId, productId)}
                  </span>
                  {onForgetDevice && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onForgetDevice(vendorId, productId)}
                    >
                      {messages.settings.forget}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-2xs text-muted">{messages.settings.devicesHint}</p>
          </>
        ) : (
          <p className="text-2xs text-muted">{messages.settings.noDevices}</p>
        )}
      </Section>

      {appInfo && (
        <Section title={messages.settings.about}>
          <p className="text-xs text-ink">
            {messages.settings.build(appInfo.version, formatBuildTime(appInfo.buildTime))}
          </p>
          <p className="text-2xs text-muted">{messages.settings.runtime(appInfo.runtime)}</p>
          {autostart != null && (
            <label className="flex items-start gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={autostart}
                onChange={(event) => onAutostart?.(event.target.checked)}
                className="mt-0.5 accent-ink"
              />
              <span>
                {messages.settings.autostart}
                <span className="block text-2xs text-muted">{messages.settings.autostartHint}</span>
              </span>
            </label>
          )}
          {update && <UpdateRow update={update} onCheck={onCheckUpdate} onApply={onApplyUpdate} />}
          <p className="break-all font-mono text-2xs text-muted">{appInfo.logPath}</p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => window.api?.openLog()}>
              {messages.settings.openLog}
            </Button>
            <span className="min-w-0 flex-1 text-2xs text-muted">{messages.settings.logHint}</span>
          </div>
        </Section>
      )}
    </div>
  )
}
