/**
 * ボタンから開く小さなメニュー。
 *
 * 使う頻度の低い操作(キーマップの読み直し・切断)をツールバーに並べておくと、よく使う操作と
 * 同じ重さに見え、切断を押し間違えやすかった。デバイス名のボタンの下にしまう。
 *
 * 外を押すか Esc で閉じる。項目を選んでも閉じる。
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import { cn } from '../../lib/cn'

const CloseContext = createContext<() => void>(() => undefined)

export interface MenuProps {
  /** 開くボタンの中身。 */
  label: ReactNode
  /** 開くボタンのツールチップ。 */
  title?: string
  children: ReactNode
  className?: string
}

export function Menu({ label, title, children, className }: MenuProps): JSX.Element {
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((on) => !on)}
        className={cn(
          'flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-xs transition-colors',
          'outline-none hover:bg-line-soft focus-visible:ring-2 focus-visible:ring-ink/60',
          open && 'bg-line-soft'
        )}
      >
        {label}
        <span aria-hidden className="shrink-0 text-2xs text-muted">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-lg shadow-black/40"
        >
          <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
        </div>
      )}
    </div>
  )
}

export interface MenuItemProps {
  onSelect: () => void
  children: ReactNode
  /** 右に添える補足(状態やショートカット)。 */
  hint?: ReactNode
  disabled?: boolean
}

export function MenuItem({ onSelect, children, hint, disabled }: MenuItemProps): JSX.Element {
  const close = useContext(CloseContext)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left text-xs text-ink',
        'outline-none hover:bg-line-soft focus-visible:bg-line-soft disabled:opacity-50'
      )}
    >
      {children}
      {hint && <span className="text-2xs text-muted">{hint}</span>}
    </button>
  )
}
