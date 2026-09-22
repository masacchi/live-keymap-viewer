/**
 * キーボードの図の枠。
 *
 * ベース以外のレイヤーが出ているあいだは、図全体をそのレイヤーの色で縁取り、背景にも薄く同じ色を
 * 敷く。視線がキーの上にあっても気づけるように。プレビュー中は縁を破線にして、実際の状態では
 * ないことを示す(縁の上の札は notice で渡す)。
 */
import type { JSX, ReactNode } from 'react'
import { layerColor } from '../lib/theme'

export function KeyboardFrame({
  shownLayer,
  preview,
  notice,
  children
}: {
  /** 図に出しているレイヤー。 */
  shownLayer: number
  /** プレビュー中か。 */
  preview: boolean
  /** 縁の上に重ねる札。 */
  notice?: ReactNode
  children: ReactNode
}): JSX.Element {
  const color = layerColor(shownLayer)
  const base = shownLayer === 0
  return (
    <div
      className="relative min-h-0 flex-1 rounded-xl border-4 p-1.5 transition-colors"
      style={{
        // ベースレイヤーは縁を出さない(プレビューで L0 を出しているときだけ破線で出す)
        borderColor: base && !preview ? 'transparent' : color,
        borderStyle: preview ? 'dashed' : 'solid',
        backgroundColor: base ? 'transparent' : `color-mix(in srgb, ${color} 14%, transparent)`
      }}
    >
      {notice}
      {children}
    </div>
  )
}
