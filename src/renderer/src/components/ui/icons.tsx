/**
 * 小さなアイコン。アイコンのライブラリは入れず、使うものだけ SVG で書く(依存を増やさない方針)。
 * 絵文字(⚙ など)は Windows でカラーの絵文字になることがあるので使わない。
 */
import type { JSX, SVGProps } from 'react'

/** 設定(スライダー 3 本)。 */
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
