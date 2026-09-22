import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HidCandidate } from '../../shared/ipc'
import { DevicePicker } from './components/DevicePicker'
import { KeyboardView } from './components/KeyboardView'
import { LayerStrip } from './components/LayerStrip'
import { LoadingPanel } from './components/LoadingPanel'
import { OVERLAY_FADED_OPACITY, OverlayControls, overlayFaded } from './components/OverlayControls'
import { PreviewNotice } from './components/PreviewNotice'
import { Toolbar } from './components/Toolbar'
import { UnlockPanel } from './components/UnlockPanel'
import { Button } from './components/ui/Button'
import { summarizeLayers } from './engine/layerSummary'
import { useVialKeyboard } from './hooks/useVialKeyboard'
import { MOD_SHIFT } from './keycodes/decode'
import type { LabelContext, LabelMode } from './keycodes/labels'
import { cn } from './lib/cn'
import { layerColor } from './lib/theme'

type WindowMode = 'normal' | 'overlay'

export default function App(): JSX.Element {
  const keyboard = useVialKeyboard()
  const [labelMode, setLabelMode] = useState<LabelMode>('jis')
  const [windowMode, setWindowMode] = useState<WindowMode>('normal')
  const [overlayOpacity, setOverlayOpacity] = useState(0.82)
  const [overlayAutoFade, setOverlayAutoFade] = useState(true)
  /** キーボードの UID ごとのレイヤー名(設定の layerNames)。 */
  const [layerNames, setLayerNames] = useState<Record<string, string[]>>({})
  const [candidates, setCandidates] = useState<HidCandidate[] | null>(null)

  // 設定を読み、オーバーレイなら body にクラスを付けて背景を透かす
  useEffect(() => {
    void window.api?.getSettings().then((settings) => {
      setLabelMode(settings.labelMode)
      setWindowMode(settings.mode)
      setOverlayOpacity(settings.overlayOpacity)
      setOverlayAutoFade(settings.overlayAutoFade)
      setLayerNames(settings.layerNames)
    })
  }, [])

  useEffect(() => {
    document.body.classList.toggle('overlay', windowMode === 'overlay')
  }, [windowMode])

  // main からのモード変更(グローバルショートカット)はウィンドウ再生成で反映されるので、
  // 起動時に現在のモードを聞き直す
  useEffect(() => {
    void window.api?.getMode().then(setWindowMode)
  }, [])

  useEffect(() => window.api?.onChooseDevice(setCandidates), [])

  const onLabelMode = useCallback((mode: LabelMode) => {
    setLabelMode(mode)
    void window.api?.setLabelMode(mode)
  }, [])

  const onToggleWindowMode = useCallback(() => {
    void window.api?.toggleMode()
  }, [])

  const onOverlayOpacity = useCallback((value: number) => {
    setOverlayOpacity(value)
    void window.api?.setOverlayOpacity(value)
  }, [])

  const onOverlayAutoFade = useCallback((on: boolean) => {
    setOverlayAutoFade(on)
    void window.api?.setOverlayAutoFade(on)
  }, [])

  const onChooseDevice = useCallback((deviceId: string | null) => {
    window.api?.chooseDevice(deviceId)
    setCandidates(null)
  }, [])

  const { geometry, snapshot, engine, layers } = keyboard
  const ready = geometry !== null && snapshot !== null && engine !== null && layers !== null

  const overlay = windowMode === 'overlay'

  /**
   * プレビュー中のレイヤー(LayerStrip で選ぶ)。ポインタを乗せているあいだ(hovered)と、
   * 押して固定したもの(preview)がある。乗せている方が勝つ。
   * キーを押したらどちらもやめて実際の表示に戻す ― 打ち始めたのに違うレイヤーが出たままだと、
   * 押したキーと図が食い違うので。
   */
  const [preview, setPreview] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const heldRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const held = new Set(layers?.held.keys() ?? [])
    const pressedNew = [...held].some((id) => !heldRef.current.has(id))
    heldRef.current = held
    if (pressedNew) {
      setPreview(null)
      setHovered(null)
    }
  }, [layers])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  // キーボードが替わったり、レイヤーの数が減ったりしたら、その番号は意味を失う
  const layerCount = snapshot?.layers ?? 0
  useEffect(() => {
    const valid = (current: number | null) =>
      current !== null && current < layerCount ? current : null
    setPreview(valid)
    setHovered(valid)
  }, [layerCount])

  const requested = overlay ? null : (hovered ?? preview)
  // 実際に出ているレイヤーを「プレビュー」しても何も変わらないので、札や破線は出さない
  const previewLayer = requested === layers?.displayLayer ? null : requested
  const shownLayer = previewLayer ?? layers?.displayLayer ?? 0

  const shift = ((layers?.mods ?? 0) & MOD_SHIFT) !== 0
  const faded =
    overlay &&
    overlayFaded({
      autoFade: overlayAutoFade,
      shownLayer,
      shift,
      status: keyboard.status,
      error: keyboard.error
    })

  const summaries = useMemo(() => (snapshot ? summarizeLayers(snapshot) : []), [snapshot])
  const labelContext = useMemo<LabelContext>(
    () => ({ customKeycodes: snapshot?.definition.customKeycodes, tapDance: snapshot?.tapDance }),
    [snapshot]
  )
  // プレビュー中は、そのレイヤーに入るキーを図の上で縁取る(「このキーでここに来る」)
  const triggerKeys = useMemo(
    () => (previewLayer === null ? [] : (summaries[previewLayer]?.triggers ?? [])),
    [summaries, previewLayer]
  )

  const uid = snapshot?.uid ?? null
  const names = (uid && layerNames[uid]) || []
  const onRename = useCallback(
    (layer: number, name: string) => {
      if (!uid) return
      void window.api?.setLayerName(uid, layer, name).then((saved) => {
        setLayerNames((current) => ({ ...current, [uid]: saved }))
      })
    },
    [uid]
  )

  return (
    <div
      className={cn('app-shell relative flex h-full flex-col overflow-hidden', faded && 'faded')}
    >
      {overlay && (
        <OverlayControls
          displayLayer={layers?.displayLayer ?? 0}
          displayLayerName={names[layers?.displayLayer ?? 0]}
          opacity={overlayOpacity}
          onOpacity={onOverlayOpacity}
          autoFade={overlayAutoFade}
          onAutoFade={onOverlayAutoFade}
          onExit={onToggleWindowMode}
        />
      )}

      {!overlay && (
        <Toolbar
          status={keyboard.status}
          deviceLabel={keyboard.deviceLabel}
          layers={
            ready && (
              <LayerStrip
                summaries={summaries}
                activeLayers={layers.activeLayers}
                shownLayer={shownLayer}
                preview={preview}
                names={names}
                labelMode={labelMode}
                labelContext={labelContext}
                onPreview={setPreview}
                onHover={setHovered}
                onRename={window.api ? onRename : undefined}
              />
            )
          }
          shift={shift}
          labelMode={labelMode}
          windowMode={windowMode}
          reloading={keyboard.reloading}
          onReload={() => void keyboard.reload()}
          onDisconnect={() => void keyboard.disconnect()}
          onLabelMode={onLabelMode}
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
                opacity: faded ? OVERLAY_FADED_OPACITY : 1,
                transition: faded ? 'opacity 400ms ease 300ms' : 'opacity 80ms ease'
              }
            : undefined
        }
      >
        {keyboard.error && (
          <div className="flex items-center gap-3 rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-xs text-ink">
            <span className="min-w-0 flex-1">{keyboard.error}</span>
            {keyboard.reconnecting ? (
              <span className="shrink-0 text-muted">自動で繋ぎ直す…</span>
            ) : (
              <Button
                size="sm"
                // オーバーレイはクリックが透過するので、付けないと押せない(OverlayControls)
                data-interactive
                onClick={() => void keyboard.connect()}
                className="shrink-0"
              >
                接続し直す
              </Button>
            )}
          </div>
        )}

        {keyboard.unlock && keyboard.status === 'unlocking' && (
          <UnlockPanel unlock={keyboard.unlock} mock={keyboard.mock} />
        )}

        {ready ? (
          <>
            {/*
             * ベース以外のレイヤーが出ているあいだは、図全体をそのレイヤーの色で縁取り、
             * 背景にも薄く同じ色を敷く。視線がキーの上にあっても気づけるように。
             * プレビュー中は縁を破線にして、実際の状態ではないことを示し、縁の上に札を出す。
             */}
            <div
              className="relative min-h-0 flex-1 rounded-xl border-4 p-1.5 transition-colors"
              style={
                shownLayer === 0
                  ? {
                      borderColor: previewLayer === null ? 'transparent' : layerColor(0),
                      borderStyle: previewLayer === null ? 'solid' : 'dashed',
                      backgroundColor: 'transparent'
                    }
                  : {
                      borderColor: layerColor(shownLayer),
                      borderStyle: previewLayer === null ? 'solid' : 'dashed',
                      backgroundColor: `color-mix(in srgb, ${layerColor(shownLayer)} 14%, transparent)`
                    }
              }
            >
              {previewLayer !== null && (
                <PreviewNotice
                  layer={previewLayer}
                  name={names[previewLayer]}
                  pinned={hovered === null}
                  onExit={() => setPreview(null)}
                />
              )}
              <KeyboardView
                geometry={geometry}
                snapshot={snapshot}
                engine={engine}
                layers={layers}
                labelMode={labelMode}
                unlockKeys={keyboard.unlock?.keys ?? []}
                onKeyClick={keyboard.mock ? keyboard.toggleMockKey : undefined}
                previewLayer={previewLayer}
                layerNames={names}
                highlightKeys={triggerKeys}
              />
            </div>
          </>
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

function EmptyState({
  onConnect,
  onMock
}: {
  onConnect: () => void
  onMock: () => void
}): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted">
        Vial のキーボードに接続すると、キーマップと押しているキーがここに出る。
      </p>
      {/* オーバーレイはクリックが透過するので、ボタンの並びだけ透過を切る(OverlayControls) */}
      <div data-interactive className="flex gap-2">
        <Button variant="primary" size="lg" onClick={onConnect}>
          キーボードに接続
        </Button>
        <Button size="lg" onClick={onMock}>
          モックで試す
        </Button>
      </div>
    </div>
  )
}
