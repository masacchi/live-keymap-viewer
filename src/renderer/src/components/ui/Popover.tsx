/**
 * ボタンから開くパネル。メニュー(Menu)と設定パネルが使う。
 *
 * 外を押すか Esc で閉じる。中身に関数を渡すと、閉じる関数を受け取れる(項目を選んだら閉じる、など)。
 */
import { type JSX, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

export interface PopoverProps {
  /** 開くボタンの中身。 */
  label: ReactNode
  /** 開くボタンのツールチップ。 */
  title?: string
  /** パネルをボタンの左端に揃えるか(start)、右端に揃えるか(end)。 */
  align?: 'start' | 'end'
  /** パネルの役割。メニューなら menu、設定のように入力を含むなら dialog。 */
  role: 'menu' | 'dialog'
  children: ReactNode | ((close: () => void) => ReactNode)
  className?: string
  buttonClassName?: string
  panelClassName?: string
}

export function Popover({
  label,
  title,
  align = 'start',
  role,
  children,
  className,
  buttonClassName,
  panelClassName
}: PopoverProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        title={title}
        aria-haspopup={role}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((on) => !on)}
        className={cn(
          'outline-none focus-visible:ring-2 focus-visible:ring-ink/60',
          buttonClassName,
          open && 'bg-line-soft'
        )}
      >
        {label}
      </button>
      {open && (
        <div
          id={id}
          role={role}
          className={cn(
            'absolute top-full z-30 mt-1 rounded-lg border border-line bg-surface p-1 shadow-lg shadow-black/40',
            align === 'start' ? 'left-0' : 'right-0',
            panelClassName
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}
