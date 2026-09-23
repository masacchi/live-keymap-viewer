/**
 * 設定パネル(ツールバーの「設定」から開く)。
 *
 * - レイヤー名 … 以前はツールバーのレイヤーをダブルクリックするしかなく、気づけなかった
 * - ツールバー … レイヤーの行き方を番号の横に並べるか(既定は出さない。ツールチップには出る)
 * - ノブの割り当ての位置 … 図の上 / 下
 * - 長押しの判定時間 … キーボードの設定と合わせる(ずれると表示だけ早く / 遅く切り替わる)
 * - オーバーレイの濃さと自動フェード … 以前はオーバーレイに入ってからでないと変えられなかった
 * - 許可したキーボード … 以前は settings.json を手で直すしかなかった
 *
 * 表記(JIS / US)はよく切り替えるので、ここではなくツールバーに置いたまま。
 */
import type { JSX, ReactNode } from 'react'
import type { AppInfo } from '../../../shared/ipc'
import {
  LAYER_NAME_MAX_LENGTH,
  OVERLAY_FADED_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  type OverlaySettings,
  type Settings,
  type SettingsPatch,
  TAPPING_TERM_MAX,
  TAPPING_TERM_MIN
} from '../../../shared/settings'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'
import { messages } from '../messages'
import { Button } from './ui/Button'
import { PercentSlider, Slider } from './ui/Slider'

export interface SettingsLayer {
  layer: number
  /** そのレイヤーへの行き方(「Space 長押し」)。無ければ null。 */
  how: string | null
}

export interface SettingsPanelProps {
  /** 名前を付けられるレイヤー(中身のあるもの)。キーボードを読み込むまでは空。 */
  layers: readonly SettingsLayer[]
  names: readonly string[]
  /** 名前を付けた(空なら消した)とき。渡さなければ名前の欄は出さない。 */
  onRename?: (layer: number, name: string) => void
  /** いまの設定(このパネルで変える項目)。 */
  settings: Pick<Settings, 'tappingTerm' | 'grantedDevices' | 'showLayerTriggers'> & OverlaySettings
  onChange: (patch: SettingsPatch) => void
  /** 許可したキーボードを忘れる。渡さなければ一覧だけ出す(保存できないとき)。 */
  onForgetDevice?: (vendorId: number, productId: number) => void
  /** 後ろのぼかしが使えるか(Windows のときだけ)。 */
  blurSupported: boolean
  /** どのビルドが動いているか。取れていなければ欄を出さない(ブラウザで開いたとき)。 */
  appInfo?: AppInfo | null
}

/** ビルドした時刻(ISO)を「2026-09-23 19:48」の形にする。読めなければ空。 */
function formatBuildTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
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
  onForgetDevice,
  blurSupported,
  appInfo
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
                    className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 text-xs text-ink outline-none placeholder:text-faint focus:border-ink/60"
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

      <Section title={messages.settings.keys}>
        <Slider
          label={messages.settings.tappingTerm}
          value={settings.tappingTerm}
          min={TAPPING_TERM_MIN}
          max={TAPPING_TERM_MAX}
          step={10}
          format={messages.settings.tappingTermValue}
          onChange={(tappingTerm) => onChange({ tappingTerm })}
          className="gap-2 text-xs text-ink"
          labelClassName="w-20"
          trackClassName="flex-1"
          valueClassName="w-14"
        />
        <p className="text-2xs text-muted">{messages.settings.tappingTermHint}</p>
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
          <p className="text-2xs text-muted">{messages.settings.electron(appInfo.electron)}</p>
          <p className="break-all font-mono text-2xs text-faint">{appInfo.logPath}</p>
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
