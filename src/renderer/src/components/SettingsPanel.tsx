/**
 * 設定パネル(ツールバーの「設定」から開く)。
 *
 * - レイヤー名 … 以前はツールバーのレイヤーをダブルクリックするしかなく、気づけなかった
 * - ノブの割り当ての位置 … 図の上 / 下
 * - オーバーレイの濃さと自動フェード … 以前はオーバーレイに入ってからでないと変えられなかった
 *
 * 表記(JIS / US)はよく切り替えるので、ここではなくツールバーに置いたまま。
 */
import type { JSX, ReactNode } from 'react'
import {
  LAYER_NAME_MAX_LENGTH,
  OVERLAY_FADED_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  type OverlaySettings,
  type Settings,
  type SettingsPatch
} from '../../../shared/settings'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'
import { Button } from './ui/Button'
import { PercentSlider } from './ui/PercentSlider'

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
  settings: Pick<Settings, 'encoderPlacement'> & OverlaySettings
  onChange: (patch: SettingsPatch) => void
  /** 後ろのぼかしが使えるか(Windows のときだけ)。 */
  blurSupported: boolean
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
  blurSupported
}: SettingsPanelProps): JSX.Element {
  return (
    <div className="w-80 divide-y divide-line-soft">
      <Section title="レイヤー名">
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
                    aria-label={`L${layer} の名前`}
                    placeholder={how ?? '名前なし'}
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
            <p className="text-2xs text-muted">
              キーの色帯やツールバーに出る。キーボードごとに覚える。空にすると消える
            </p>
          </>
        ) : (
          <p className="text-2xs text-muted">キーボードに繋ぐと付けられる</p>
        )}
      </Section>

      <Section title="ノブの割り当て">
        <div className="flex overflow-hidden rounded-md border border-line-soft">
          {(
            [
              ['top', '図の上'],
              ['bottom', '図の下']
            ] as const
          ).map(([placement, text]) => (
            <Button
              key={placement}
              selected={settings.encoderPlacement === placement}
              aria-pressed={settings.encoderPlacement === placement}
              onClick={() => onChange({ encoderPlacement: placement })}
              className="flex-1 rounded-none"
            >
              {text}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="オーバーレイ">
        <PercentSlider
          label="濃さ"
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
            L0 のあいだは薄くする
            <span className="block text-2xs text-muted">
              ほかのレイヤーに入るか Shift を押すと濃く戻る
            </span>
          </span>
        </label>
        <PercentSlider
          label="薄くしたとき"
          title="薄くしたときに残す濃さ。0% で消える(左上のパネルは残る)"
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
            後ろの画面をぼかす
            <span className="block text-2xs text-muted">
              {blurSupported
                ? 'すりガラスのように(Windows 11)。強さは OS が決める。薄くしているあいだは外す'
                : 'Windows 11 でだけ使える'}
            </span>
          </span>
        </label>
        <p className="text-2xs text-muted">オーバーレイの左上のパネルからも変えられる</p>
      </Section>
    </div>
  )
}
