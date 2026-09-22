/**
 * オーバーレイ中の操作パネル。
 *
 * オーバーレイはクリックを透過させるので、普通に置いたボタンは押せない。
 * `setIgnoreMouseEvents(true, { forward: true })` のおかげで透過中でも
 * mousemove だけは renderer に届くので、ポインタがこのパネルの上に来た瞬間だけ
 * 透過を切る。パネルから外れたら戻す。ドラッグ中は判定を止める。
 *
 * パネル内の要素には `data-interactive` を付ける。判定はその有無で行う。
 */
import { type JSX, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'

export interface OverlayControlsProps {
  displayLayer: number
  /** そのレイヤーの名前。無ければ番号だけ。 */
  displayLayerName?: string
  opacity: number
  onOpacity: (value: number) => void
  onExit: () => void
}

export function OverlayControls({
  displayLayer,
  displayLayerName,
  opacity,
  onOpacity,
  onExit
}: OverlayControlsProps): JSX.Element {
  /** ドラッグ中は前回のポインタ位置(画面座標)。していなければ null。 */
  const dragging = useRef<{ x: number; y: number; kind: 'move' | 'resize' } | null>(null)
  const [active, setActive] = useState(false)

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
      const interactive = element?.closest('[data-interactive]') != null
      setActive(interactive)
      apply(!interactive)
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
        data-interactive
        className={[
          'absolute left-2 top-2 z-20 flex items-center gap-2 rounded-lg border px-2 py-1.5',
          'border-[var(--line)] bg-[var(--surface)] transition-opacity',
          active ? 'opacity-100' : 'opacity-45'
        ].join(' ')}
      >
        <span
          title="ドラッグでウィンドウを移動"
          onPointerDown={startDrag('move')}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="cursor-move select-none px-1 text-sm leading-none text-[var(--muted)]"
        >
          ⠿
        </span>

        <span
          className="rounded px-1.5 py-0.5 text-xs font-bold leading-none text-neutral-900"
          style={{ backgroundColor: `var(--layer-${displayLayer % 10})` }}
        >
          L{displayLayer}
          {displayLayerName && <span className="ml-1 font-semibold">{displayLayerName}</span>}
        </span>

        <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          濃さ
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={Math.round(opacity * 100)}
            onChange={(event) => onOpacity(Number(event.target.value) / 100)}
            className="h-1 w-24 accent-[var(--layer-2)]"
          />
          <span className="w-8 tabular-nums text-right text-[var(--ink)]">
            {Math.round(opacity * 100)}%
          </span>
        </label>

        <button
          type="button"
          onClick={onExit}
          className="rounded bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--line-soft)]"
        >
          通常ウィンドウに戻す
        </button>
      </div>

      {/* 右下のリサイズつまみ。枠が無いので OS の境界は使えない */}
      <div
        data-interactive
        title="ドラッグで大きさを変える"
        onPointerDown={startDrag('resize')}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={[
          'absolute bottom-0 right-0 z-20 size-5 cursor-nwse-resize',
          'border-b-[3px] border-r-[3px] border-[var(--muted)] transition-opacity',
          active ? 'opacity-100' : 'opacity-40'
        ].join(' ')}
      />
    </>
  )
}
