/**
 * 小さなアイコン。アイコンのライブラリは入れず、使うものだけSVGで書く(依存を増やさない方針)。
 * 絵文字(⚙ など)はWindowsでカラーの絵文字になることがあるので使わない。
 */
import type { JSX, SVGProps } from 'react'

/** 設定(スライダー3本)。 */
export function SlidersIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <path d="M2 4h7M13 4h1M2 8h2M8 8h6M2 12h9M14 12h0" />
      <circle cx={11} cy={4} r={1.75} />
      <circle cx={6} cy={8} r={1.75} />
      <circle cx={12.5} cy={12} r={1.75} />
    </svg>
  )
}

/**
 * 読み込み中の印。薄い輪の上を短い弧が回る。回すのは呼び出し側(animate-spin)、色はcurrentColor。
 * ツールバーで状態の丸(8px)の代わりに出す。輪は線なので、丸と同じくらいに見えるよう12pxにしてある。
 */
export function SpinnerIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width={12}
      height={12}
      fill="none"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <circle cx={8} cy={8} r={6} stroke="currentColor" opacity={0.25} />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" />
    </svg>
  )
}
