/**
 * オーバーレイ中の操作パネル。
 *
 * オーバーレイはクリックを透過させるので、普通に置いたボタンは押せない。
 * `setIgnoreMouseEvents(true, { forward: true })` のおかげで透過中でも
 * mousemove だけは renderer に届くので、ポインタがこのパネルの上に来た瞬間だけ
 * 透過を切る。パネルから外れたら戻す。ドラッグ中は判定を止める。
 *
 * 透過を切りたい要素には `data-interactive` を付ける。判定はその有無で行う。
 * このパネルのほか、未接続の画面の接続ボタンやデバイスの選択にも付いている
 * (付け忘れると、オーバーレイでは見えているのに押せないボタンになる)。
 */
import { type JSX, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  OVERLAY_FADED_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  type OverlaySettings,
  type SettingsPatch
} from '../../../shared/settings'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'
import { messages } from '../messages'
import { Button } from './ui/Button'
import { PercentSlider } from './ui/PercentSlider'

export interface OverlayControlsProps {
  displayLayer: number
  /** そのレイヤーの名前。無ければ番号だけ。 */
  displayLayerName?: string
  /** 濃さ・L0 で薄く・薄くしたときの濃さ・後ろのぼかし。 */
  settings: OverlaySettings
  onChange: (patch: SettingsPatch) => void
  /** ぼかしが使えるか(Windows のときだけ)。使えなければ欄を出さない。 */
  blurSupported: boolean
  onExit: () => void
}

export function OverlayControls({
  displayLayer,
  displayLayerName,
  settings,
  onChange,
  blurSupported,
  onExit
}: OverlayControlsProps): JSX.Element {
  /** ドラッグ中は前回のポインタ位置(画面座標)。していなければ null。 */
  const dragging = useRef<{ x: number; y: number; kind: 'move' | 'resize' } | null>(null)
  /** ポインタが透過を切っている要素(パネル・つまみ・接続ボタン)の上にあるか。 */
  const [active, setActive] = useState(false)
  /**
   * パネルを広げているか(ポインタがパネルの上にある)。ふだんは「⠿ L2」だけにしておく。
   * 以前は濃さ・L0 で薄く・戻すが常に並んでいて、最前面のウィンドウの左上を横長に塞いでいた。
   */
  const [expanded, setExpanded] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  // ポインタがパネルの上にあるあいだだけ、クリック透過を切る
  useEffect(() => {
    let ignoring = true
    const apply = (ignore: boolean): void => {
      if (ignore === ignoring) return
      ignoring = ignore
      window.api?.setIgnoreMouseEvents(ignore)
    }
    const onMove = (event: MouseEvent): void => {
      if (dragging.current) return // ドラッグ中は外に出ても離さない
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const target = element?.closest('[data-interactive]') ?? null
      setActive(target !== null)
      setExpanded(target !== null && panel.current?.contains(target) === true)
      apply(target === null)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.api?.setIgnoreMouseEvents(true)
    }
  }, [])

  const startDrag = useCallback(
    (kind: 'move' | 'resize') => (event: PointerEvent<HTMLElement>) => {
      event.preventDefault()
      dragging.current = { x: event.screenX, y: event.screenY, kind }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    []
  )

  const onDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const from = dragging.current
    if (!from) return
    const dx = event.screenX - from.x
    const dy = event.screenY - from.y
    if (dx === 0 && dy === 0) return
    dragging.current = { ...from, x: event.screenX, y: event.screenY }
    // ポインタの画面座標との差分なので、ウィンドウが付いてきても破綻しない
    if (from.kind === 'move') window.api?.moveBy(dx, dy)
    else window.api?.resizeBy(dx, dy)
  }, [])

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    dragging.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  return (
    <>
      <div
        ref={panel}
        data-interactive
        className={cn(
          'absolute left-2 top-2 z-20 flex items-center gap-2 rounded-lg border px-2 py-1.5',
          'border-line bg-surface transition-opacity',
          active ? 'opacity-100' : 'opacity-45'
        )}
      >
        <span
          title={messages.overlay.move}
          onPointerDown={startDrag('move')}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="cursor-move select-none px-1 text-sm leading-none text-muted"
        >
          ⠿
        </span>

        <span
          className="rounded-md px-1.5 py-0.5 text-xs font-bold leading-none text-ink-inverse"
          style={{ backgroundColor: layerColor(displayLayer) }}
        >
          L{displayLayer}
          {displayLayerName && <span className="ml-1 font-semibold">{displayLayerName}</span>}
        </span>

        {/* 畳んでいるあいだは隠すだけ(外すと、広げた瞬間にパネルの幅が決まらずポインタが外れる) */}
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs text-muted',
            !expanded && 'hidden'
          )}
        >
          <PercentSlider
            label={messages.overlay.opacity}
            value={settings.overlayOpacity}
            min={OVERLAY_OPACITY_MIN}
            max={1}
            onChange={(overlayOpacity) => onChange({ overlayOpacity })}
          />

          <span className="flex items-center gap-1.5">
            <label className="flex items-center gap-1" title={messages.overlay.autoFadeHint}>
              <input
                type="checkbox"
                checked={settings.overlayAutoFade}
                onChange={(event) => onChange({ overlayAutoFade: event.target.checked })}
                className="accent-ink"
              />
              {messages.overlay.autoFade}
            </label>
            <PercentSlider
              label={messages.overlay.fadedOpacity}
              title={messages.overlay.fadedOpacityHint}
              value={settings.overlayFadedOpacity}
              min={0}
              max={OVERLAY_FADED_OPACITY_MAX}
              onChange={(overlayFadedOpacity) => onChange({ overlayFadedOpacity })}
              disabled={!settings.overlayAutoFade}
              trackClassName="w-16"
            />
          </span>

          {blurSupported && (
            <label className="flex items-center gap-1" title={messages.overlay.blurHint}>
              <input
                type="checkbox"
                checked={settings.overlayBlur}
                onChange={(event) => onChange({ overlayBlur: event.target.checked })}
                className="accent-ink"
              />
              {messages.overlay.blur}
            </label>
          )}

          {/* パネル自体が bg-surface なので、ボタンは一段明るい面にする */}
          <Button size="sm" onClick={onExit} className="bg-raised hover:bg-line">
            {messages.overlay.exit}
          </Button>
        </div>
      </div>

      {/* 右下のリサイズつまみ。枠が無いので OS の境界は使えない */}
      <div
        data-interactive
        title={messages.overlay.resize}
        onPointerDown={startDrag('resize')}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'absolute bottom-0 right-0 z-20 size-5 cursor-nwse-resize',
          'border-b-[3px] border-r-[3px] border-muted transition-opacity',
          active ? 'opacity-100' : 'opacity-40'
        )}
      />
    </>
  )
}
