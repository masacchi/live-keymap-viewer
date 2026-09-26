/**
 * キーボードの図の枠。
 *
 * ベース以外のレイヤーが出ているあいだは、図全体をそのレイヤーの色で縁取り、背景にも薄く同じ色を
 * 敷く。視線がキーの上にあっても気づけるように。プレビュー中は縁を破線にして、実際の状態では
 * ないことを示す(縁の上のラベルはnoticeで渡す)。
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
  /** 縁の上に重ねるラベル。 */
  notice?: ReactNode
  children: ReactNode
}): JSX.Element {
  const color = layerColor(shownLayer)
  const base = shownLayer === 0
  // 縁の色の切り替えは短くする。キーの色はその場で変わるので、縁だけ遅れると
  // レイヤーが変わるたびに図と縁がずれて見える
  return (
    <div
      className="relative min-h-0 flex-1 rounded-xl border-4 p-1.5 transition-colors duration-75"
      style={{
        // ベースレイヤーは縁を出さない(プレビューでL0を出しているときだけ破線で出す)
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
