import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EncoderPlacement, HidCandidate } from '../../shared/ipc'
import { DevicePicker } from './components/DevicePicker'
import { KeyboardView } from './components/KeyboardView'
import { describeTrigger, LayerStrip } from './components/LayerStrip'
import { LoadingPanel } from './components/LoadingPanel'
import { OverlayControls, overlayFaded } from './components/OverlayControls'
import { PreviewNotice } from './components/PreviewNotice'
import { SettingsPanel } from './components/SettingsPanel'
import { RouteChips, routeSteps, SymbolFinder } from './components/SymbolFinder'
import { Toolbar } from './components/Toolbar'
import { UnlockPanel } from './components/UnlockPanel'
import { Button } from './components/ui/Button'
import { summarizeLayers } from './engine/layerSummary'
import { findSymbolRoutes, type SymbolRoute, shiftKeysOf } from './engine/symbolRoutes'
import { useVialKeyboard } from './hooks/useVialKeyboard'
import { decodeKeycode, MOD_SHIFT } from './keycodes/decode'
import { type LabelContext, type LabelMode, labelForKeycode } from './keycodes/labels'
import { cn } from './lib/cn'
import { layerColor } from './lib/theme'

type WindowMode = 'normal' | 'overlay'

/**
 * オーバーレイを薄くし始めるまでの待ち(ms)。レイヤーキーの短い押下で薄い / 濃いを
 * 行き来してちらつかせないため。
 */
const FADE_DELAY_MS = 300

/**
 * 後ろの画面のぼかし(Windows 11 のアクリル)が使えるか。main は Windows でしか効かせないので、
 * ほかでは欄を出さない / 押せなくする。Windows 10 でも欄は出るが、効かないだけ。
 */
const BLUR_SUPPORTED = navigator.userAgent.includes('Windows')

export default function App(): JSX.Element {
  const keyboard = useVialKeyboard()
  const [labelMode, setLabelMode] = useState<LabelMode>('jis')
  const [windowMode, setWindowMode] = useState<WindowMode>('normal')
  const [overlayOpacity, setOverlayOpacity] = useState(0.82)
  const [overlayAutoFade, setOverlayAutoFade] = useState(true)
  const [overlayFadedOpacity, setOverlayFadedOpacity] = useState(0.2)
  const [overlayBlur, setOverlayBlur] = useState(false)
  const [encoderPlacement, setEncoderPlacement] = useState<EncoderPlacement>('bottom')
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
      setOverlayFadedOpacity(settings.overlayFadedOpacity)
      setOverlayBlur(settings.overlayBlur)
      setEncoderPlacement(settings.encoderPlacement)
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

  const onOverlayFadedOpacity = useCallback((value: number) => {
    setOverlayFadedOpacity(value)
    void window.api?.setOverlayFadedOpacity(value)
  }, [])

  const onOverlayBlur = useCallback((on: boolean) => {
    setOverlayBlur(on)
    void window.api?.setOverlayBlur(on)
  }, [])

  const onEncoderPlacement = useCallback((placement: EncoderPlacement) => {
    setEncoderPlacement(placement)
    void window.api?.setEncoderPlacement(placement)
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
  /** 記号の出し方で選んだ記号と、その打ち方。そのレイヤーを出しているあいだだけ効かせる。 */
  const [lookup, setLookup] = useState<{ symbol: string; route: SymbolRoute } | null>(null)
  const heldRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const held = new Set(layers?.held.keys() ?? [])
    const pressedNew = [...held].some((id) => !heldRef.current.has(id))
    heldRef.current = held
    if (pressedNew) {
      setPreview(null)
      setHovered(null)
      setLookup(null)
    }
  }, [layers])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setPreview(null)
      setLookup(null)
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
    setLookup(null)
  }, [layerCount])
  /** レイヤーの一覧やプレビューの札から、固定のプレビューを変えるとき。記号の案内はやめる。 */
  const onPinPreview = useCallback((layer: number | null) => {
    setLookup(null)
    setPreview(layer)
  }, [])

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

  // 記号の出し方。どの文字が出るかは表記で変わる。行き方の無いレイヤーの文字は打てないので数えない
  const symbolRoutes = useMemo(
    () =>
      snapshot
        ? findSymbolRoutes({
            keymap: snapshot.keymap,
            labelOf: (keycode) => labelForKeycode(keycode, labelMode, labelContext),
            reachable: (layer) => (summaries[layer]?.triggers.length ?? 0) > 0
          })
        : new Map<string, SymbolRoute[]>(),
    [snapshot, labelMode, labelContext, summaries]
  )
  const shiftKeys = useMemo(() => (snapshot ? shiftKeysOf(snapshot.keymap) : []), [snapshot])
  const stepsOf = useCallback(
    (route: SymbolRoute) => {
      const raw = snapshot?.keymap[0]?.[route.row]?.[route.col] ?? 0
      const keyName = labelForKeycode(decodeKeycode(raw), labelMode, labelContext).main
      const trigger = summaries[route.layer]?.triggers[0]
      return routeSteps(
        route,
        keyName,
        trigger ? describeTrigger(trigger, labelMode, labelContext) : null
      )
    },
    [snapshot, labelMode, labelContext, summaries]
  )
  const onPickSymbol = useCallback((symbol: string, route: SymbolRoute) => {
    setHovered(null)
    setPreview(route.layer === 0 ? null : route.layer)
    setLookup({ symbol, route })
  }, [])
  // ほかのレイヤーに乗せている・押して変えたなら、案内はそのレイヤーには当てはまらない
  const activeLookup =
    lookup && hovered === null && preview === (lookup.route.layer === 0 ? null : lookup.route.layer)
      ? lookup
      : null
  const flashKeys = useMemo(
    () =>
      activeLookup ? [activeLookup.route, ...(activeLookup.route.shift ? shiftKeys : [])] : [],
    [activeLookup, shiftKeys]
  )

  // アンロックで押すキーの名前。ロック中はレイヤーが動かないので、ベースレイヤーの表示で言う
  const unlockKeyNames = useMemo(
    () =>
      (keyboard.unlock?.keys ?? []).map(
        ({ row, col }) =>
          labelForKeycode(
            decodeKeycode(snapshot?.keymap[0]?.[row]?.[col] ?? 0),
            labelMode,
            labelContext
          ).main
      ),
    [keyboard.unlock?.keys, snapshot, labelMode, labelContext]
  )

  // 後ろのぼかし(OS が描く)も、図を薄くしているあいだは外す。図が薄くなり始めるのは 300ms 後
  // (下の transition)なので、外すのも同じだけ待つ。濃く戻すときはすぐ
  useEffect(() => {
    if (!overlay) return
    if (!faded) {
      window.api?.setOverlayBlurActive(true)
      return
    }
    const timer = setTimeout(() => window.api?.setOverlayBlurActive(false), FADE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [overlay, faded])

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
          fadedOpacity={overlayFadedOpacity}
          onFadedOpacity={onOverlayFadedOpacity}
          blur={overlayBlur}
          onBlur={onOverlayBlur}
          blurSupported={BLUR_SUPPORTED}
          onExit={onToggleWindowMode}
        />
      )}

      {!overlay && (
        <Toolbar
          status={keyboard.status}
          deviceLabel={keyboard.deviceLabel}
          // アンロック中は押下が読めず、レイヤーも切り替わらないので一覧は出さない
          layers={
            ready &&
            keyboard.status !== 'unlocking' && (
              <LayerStrip
                summaries={summaries}
                activeLayers={layers.activeLayers}
                shownLayer={shownLayer}
                preview={preview}
                names={names}
                labelMode={labelMode}
                labelContext={labelContext}
                onPreview={onPinPreview}
                onHover={setHovered}
                onRename={window.api ? onRename : undefined}
              />
            )
          }
          settings={
            <SettingsPanel
              layers={summaries
                .filter((s) => !s.blank)
                .map((s) => ({
                  layer: s.layer,
                  how: s.triggers[0]
                    ? describeTrigger(s.triggers[0], labelMode, labelContext)
                    : null
                }))}
              names={names}
              onRename={window.api && uid ? onRename : undefined}
              encoderPlacement={encoderPlacement}
              onEncoderPlacement={onEncoderPlacement}
              overlayOpacity={overlayOpacity}
              onOverlayOpacity={onOverlayOpacity}
              overlayAutoFade={overlayAutoFade}
              onOverlayAutoFade={onOverlayAutoFade}
              overlayFadedOpacity={overlayFadedOpacity}
              onOverlayFadedOpacity={onOverlayFadedOpacity}
              overlayBlur={overlayBlur}
              onOverlayBlur={onOverlayBlur}
              blurSupported={BLUR_SUPPORTED}
            />
          }
          symbols={
            ready && keyboard.status !== 'unlocking'
              ? (close) => (
                  <SymbolFinder
                    routes={symbolRoutes}
                    stepsOf={stepsOf}
                    onPick={(symbol, route) => {
                      close()
                      onPickSymbol(symbol, route)
                    }}
                  />
                )
              : undefined
          }
          mods={ready && keyboard.status !== 'unlocking' ? layers.mods : null}
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
                opacity: faded ? overlayFadedOpacity : 1,
                transition: faded ? `opacity 400ms ease ${FADE_DELAY_MS}ms` : 'opacity 80ms ease'
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
          <UnlockPanel unlock={keyboard.unlock} keyNames={unlockKeyNames} mock={keyboard.mock} />
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
              {(activeLookup || previewLayer !== null) && (
                <PreviewNotice
                  layer={activeLookup?.route.layer ?? previewLayer ?? 0}
                  name={names[activeLookup?.route.layer ?? previewLayer ?? 0]}
                  pinned={hovered === null}
                  onExit={() => onPinPreview(null)}
                  hint={
                    activeLookup && (
                      <span className="flex items-center gap-1.5">
                        <b className="text-sm font-bold leading-none">{activeLookup.symbol}</b>
                        <span>は</span>
                        <RouteChips steps={stepsOf(activeLookup.route)} />
                      </span>
                    )
                  }
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
                flashKeys={flashKeys}
                encoderPlacement={encoderPlacement}
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
