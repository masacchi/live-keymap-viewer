/**
 * 画面全体の組み立て。状態と規則はフックに置き、ここは部品をつなぐだけにする。
 *
 *   useVialKeyboard … キーボードとの接続・押下・レイヤー
 *   useSettings     … 設定(settings.json)
 *   useKeymapGuide  … キーマップから読む案内(行き方・記号の打ち方・キーの名前)
 *   usePreview      … 図のプレビュー(乗せる・固定・記号の案内)と、戻す規則
 *   useOverlayFade  … オーバーレイを薄くするかと、後ろのぼかし
 */
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react'
import type { HidCandidate } from '../../shared/ipc'
import { DevicePicker } from './components/DevicePicker'
import { KeyboardFrame } from './components/KeyboardFrame'
import { KeyboardView } from './components/KeyboardView'
import { LayerStrip } from './components/LayerStrip'
import { LoadingPanel } from './components/LoadingPanel'
import { OverlayControls } from './components/OverlayControls'
import { PreviewNotice } from './components/PreviewNotice'
import { SettingsPanel } from './components/SettingsPanel'
import { EmptyState, ErrorBanner } from './components/StatusViews'
import { RouteChips, SymbolFinder } from './components/SymbolFinder'
import { Toolbar } from './components/Toolbar'
import { UnlockPanel } from './components/UnlockPanel'
import { useKeymapGuide } from './hooks/useKeymapGuide'
import { FADE_DELAY_MS, overlayFaded, useOverlayBlurSync } from './hooks/useOverlayFade'
import { usePreview } from './hooks/usePreview'
import { useSettings } from './hooks/useSettings'
import { useVialKeyboard } from './hooks/useVialKeyboard'
import { MOD_SHIFT } from './keycodes/decode'
import { cn } from './lib/cn'
import { messages } from './messages'

type WindowMode = 'normal' | 'overlay'

/**
 * 後ろの画面のぼかし(Windows 11 のアクリル)が使えるか。main は Windows でしか効かせないので、
 * ほかでは欄を出さない / 押せなくする。Windows 10 でも欄は出るが、効かないだけ。
 */
const BLUR_SUPPORTED = navigator.userAgent.includes('Windows')

export default function App(): JSX.Element {
  const keyboard = useVialKeyboard()
  const { settings, update: updateSettings, setLayerName, canSave } = useSettings()
  const [windowMode, setWindowMode] = useState<WindowMode>('normal')
  const [candidates, setCandidates] = useState<HidCandidate[] | null>(null)

  // オーバーレイなら body にクラスを付けて背景を透かす
  useEffect(() => {
    document.body.classList.toggle('overlay', windowMode === 'overlay')
  }, [windowMode])
  // main からのモード変更(グローバルショートカット)はウィンドウ再生成で反映されるので、
  // 起動時に現在のモードを聞き直す
  useEffect(() => {
    void window.api?.getMode().then(setWindowMode)
  }, [])
  useEffect(() => window.api?.onChooseDevice(setCandidates), [])

  const onToggleWindowMode = useCallback(() => void window.api?.toggleMode(), [])
  const onChooseDevice = useCallback((deviceId: string | null) => {
    window.api?.chooseDevice(deviceId)
    setCandidates(null)
  }, [])

  const { geometry, snapshot, engine, layers } = keyboard
  const ready = geometry !== null && snapshot !== null && engine !== null && layers !== null
  // アンロック中は押下が読めず、レイヤーも切り替わらないので、レイヤーまわりの表示は出さない
  const live = ready && keyboard.status !== 'unlocking'
  const overlay = windowMode === 'overlay'

  const guide = useKeymapGuide(snapshot, settings.labelMode)
  const preview = usePreview({ layers, layerCount: snapshot?.layers ?? 0, overlay })
  const { previewLayer, lookup } = preview
  const shownLayer = previewLayer ?? layers?.displayLayer ?? 0

  const faded =
    overlay &&
    overlayFaded({
      autoFade: settings.overlayAutoFade,
      shownLayer,
      shift: ((layers?.mods ?? 0) & MOD_SHIFT) !== 0,
      status: keyboard.status,
      error: keyboard.error
    })
  useOverlayBlurSync(overlay, faded)

  // プレビュー中は、そのレイヤーに入るキーを図の上で縁取る(「このキーでここに来る」)
  const triggerKeys = useMemo(
    () => (previewLayer === null ? [] : (guide.summaries[previewLayer]?.triggers ?? [])),
    [guide.summaries, previewLayer]
  )
  const flashKeys = useMemo(
    () => (lookup ? guide.keysToPress(lookup.route) : []),
    [lookup, guide.keysToPress]
  )
  // アンロックで押すキーの名前。ロック中はレイヤーが動かないので、ベースレイヤーの表示で言う
  const unlockKeyNames = useMemo(
    () => (keyboard.unlock?.keys ?? []).map(guide.baseKeyName),
    [keyboard.unlock?.keys, guide.baseKeyName]
  )

  const uid = snapshot?.uid ?? null
  const names = (uid && settings.layerNames[uid]) || []
  const onRename = useCallback(
    (layer: number, name: string) => {
      if (uid) setLayerName(uid, layer, name)
    },
    [uid, setLayerName]
  )

  const noticeLayer = lookup?.route.layer ?? previewLayer
  const notice = noticeLayer !== null && (
    <PreviewNotice
      layer={noticeLayer}
      name={names[noticeLayer]}
      pinned={preview.pinned}
      onExit={() => preview.pin(null)}
      hint={
        lookup && (
          <span className="flex items-center gap-1.5">
            <b className="text-sm font-bold leading-none">{lookup.symbol}</b>
            <span>{messages.preview.symbolIs}</span>
            <RouteChips steps={guide.stepsOf(lookup.route)} />
          </span>
        )
      }
    />
  )

  return (
    <div
      className={cn('app-shell relative flex h-full flex-col overflow-hidden', faded && 'faded')}
    >
      {overlay && (
        <OverlayControls
          displayLayer={layers?.displayLayer ?? 0}
          displayLayerName={names[layers?.displayLayer ?? 0]}
          settings={settings}
          onChange={updateSettings}
          blurSupported={BLUR_SUPPORTED}
          onExit={onToggleWindowMode}
        />
      )}

      {!overlay && (
        <Toolbar
          status={keyboard.status}
          deviceLabel={keyboard.deviceLabel}
          layers={
            live && (
              <LayerStrip
                summaries={guide.summaries}
                activeLayers={layers.activeLayers}
                shownLayer={shownLayer}
                preview={preview.state.pinned}
                names={names}
                labelMode={settings.labelMode}
                labelContext={guide.labelContext}
                onPreview={preview.pin}
                onHover={preview.hover}
                onRename={canSave ? onRename : undefined}
              />
            )
          }
          settings={
            <SettingsPanel
              layers={guide.summaries
                .filter((summary) => !summary.blank)
                .map(({ layer }) => ({ layer, how: guide.howTo(layer) }))}
              names={names}
              onRename={canSave && uid ? onRename : undefined}
              settings={settings}
              onChange={updateSettings}
              blurSupported={BLUR_SUPPORTED}
            />
          }
          symbols={
            live
              ? (close) => (
                  <SymbolFinder
                    routes={guide.symbolRoutes}
                    stepsOf={guide.stepsOf}
                    onPick={(symbol, route) => {
                      close()
                      preview.pickSymbol(symbol, route)
                    }}
                  />
                )
              : undefined
          }
          mods={live ? layers.mods : null}
          labelMode={settings.labelMode}
          windowMode={windowMode}
          reloading={keyboard.reloading}
          onReload={() => void keyboard.reload()}
          onDisconnect={() => void keyboard.disconnect()}
          onLabelMode={(labelMode) => updateSettings({ labelMode })}
          onToggleWindowMode={onToggleWindowMode}
        />
      )}

      <main
        className={
          overlay
            ? 'flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-11'
            : 'flex min-h-0 flex-1 flex-col gap-2 p-2 md:gap-3 md:p-4'
        }
        // 濃く戻すのはすぐ、薄くするのは少し待ってからゆっくり(レイヤーキーの短い押下でちらつかせない)
        style={
          overlay
            ? {
                opacity: faded ? settings.overlayFadedOpacity : 1,
                transition: faded ? `opacity 400ms ease ${FADE_DELAY_MS}ms` : 'opacity 80ms ease'
              }
            : undefined
        }
      >
        {keyboard.error && (
          <ErrorBanner
            message={keyboard.error}
            reconnecting={keyboard.reconnecting}
            onRetry={() => void keyboard.connect()}
          />
        )}

        {keyboard.unlock && keyboard.status === 'unlocking' && (
          <UnlockPanel unlock={keyboard.unlock} keyNames={unlockKeyNames} mock={keyboard.mock} />
        )}

        {ready ? (
          <KeyboardFrame shownLayer={shownLayer} preview={previewLayer !== null} notice={notice}>
            <KeyboardView
              geometry={geometry}
              snapshot={snapshot}
              engine={engine}
              layers={layers}
              labelMode={settings.labelMode}
              unlockKeys={keyboard.unlock?.keys ?? []}
              onKeyClick={keyboard.mock ? keyboard.toggleMockKey : undefined}
              previewLayer={previewLayer}
              layerNames={names}
              highlightKeys={triggerKeys}
              flashKeys={flashKeys}
              encoderPlacement={settings.encoderPlacement}
            />
          </KeyboardFrame>
        ) : keyboard.status === 'connecting' || keyboard.status === 'loading' ? (
          <LoadingPanel deviceLabel={keyboard.deviceLabel} progress={keyboard.loading} />
        ) : (
          <EmptyState
            onConnect={() => void keyboard.connect()}
            onMock={() => void keyboard.connectMock()}
          />
        )}
      </main>

      {candidates && <DevicePicker devices={candidates} onChoose={onChooseDevice} />}
    </div>
  )
}
