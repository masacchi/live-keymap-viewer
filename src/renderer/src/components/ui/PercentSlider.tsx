/**
 * 割合(0〜1)を 5% 刻みで選ぶスライダー。オーバーレイの操作パネルと設定パネルが使う。
 * 値の右に % を出す(スライダーだけだと、いくつなのか分からない)。
 */
import type { JSX } from 'react'
import { cn } from '../../lib/cn'

export interface PercentSliderProps {
  label: string
  /** 0〜1。 */
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  disabled?: boolean
  title?: string
  className?: string
  /** 見出しの幅など(縦に並べたときに揃える)。 */
  labelClassName?: string
  /** つまみの幅(Tailwind のクラス)。 */
  trackClassName?: string
}

export function PercentSlider({
  label,
  value,
  min,
  max,
  onChange,
  disabled = false,
  title,
  className,
  labelClassName,
  trackClassName = 'w-24'
}: PercentSliderProps): JSX.Element {
  const percent = Math.round(value * 100)
  return (
    <label
      title={title}
      className={cn('flex items-center gap-1.5', disabled && 'opacity-50', className)}
    >
      <span className={cn('shrink-0', labelClassName)}>{label}</span>
      <input
        type="range"
        min={Math.round(min * 100)}
        max={Math.round(max * 100)}
        step={5}
        value={percent}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className={cn('h-1 min-w-0 accent-ink', trackClassName)}
      />
      <span className="w-8 shrink-0 text-right tabular-nums text-ink">{percent}%</span>
    </label>
  )
}
