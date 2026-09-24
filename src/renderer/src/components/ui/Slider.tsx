/**
 * 数値を選ぶスライダー。値の右にいまの値を出す(スライダーだけだと、いくつなのか分からない)。
 * オーバーレイの操作パネルと設定パネルが使う。
 */
import type { JSX } from 'react'
import { cn } from '../../lib/cn'

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** 右に出す値の書き方(「82%」「200 ms」)。 */
  format: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
  title?: string
  className?: string
  /** 見出しの幅など(縦に並べたときに揃える)。 */
  labelClassName?: string
  /** つまみの幅(Tailwindのクラス)。 */
  trackClassName?: string
  /** 値の欄の幅。値の書き方が長いときに広げる。 */
  valueClassName?: string
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled = false,
  title,
  className,
  labelClassName,
  trackClassName = 'w-24',
  valueClassName = 'w-8'
}: SliderProps): JSX.Element {
  return (
    <label
      title={title}
      className={cn('flex items-center gap-1.5', disabled && 'opacity-50', className)}
    >
      <span className={cn('shrink-0', labelClassName)}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn('h-1 min-w-0 accent-ink', trackClassName)}
      />
      <span className={cn('shrink-0 text-right tabular-nums text-ink', valueClassName)}>
        {format(value)}
      </span>
    </label>
  )
}

export type PercentSliderProps = Omit<SliderProps, 'step' | 'format'>

/**
 * 割合(0〜1)を5%刻みで選ぶ。スライダーには整数の%で渡す ― 0.05刻みの小数のままだと
 * 0.35000000000000003のような値が戻ってくる。
 */
export function PercentSlider({ value, min, max, onChange, ...props }: PercentSliderProps) {
  return (
    <Slider
      {...props}
      value={Math.round(value * 100)}
      min={Math.round(min * 100)}
      max={Math.round(max * 100)}
      step={5}
      format={(percent) => `${percent}%`}
      onChange={(percent) => onChange(percent / 100)}
    />
  )
}
