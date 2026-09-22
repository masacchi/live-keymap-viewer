/**
 * オーバーレイを薄くするか(「L0 で薄く」)と、それに合わせた後ろのぼかしの入り切り。
 *
 * オーバーレイは常に最前面なので、ふだんの入力のあいだも画面を覆う。ベースレイヤーのあいだは
 * 図を薄くし、ほかのレイヤーに入るか Shift を押したら濃く戻す。後ろのぼかし(OS が描く)も
 * 薄くしているあいだは外す ― 薄くするのは後ろの画面を読むためなので。
 */
import { useEffect } from 'react'

/**
 * 薄くし始めるまでの待ち(ms)。レイヤーキーの短い押下で薄い / 濃いを行き来して
 * ちらつかせないため。濃く戻すのは待たない。
 */
export const FADE_DELAY_MS = 300

/**
 * オーバーレイの図を薄くするか。ベースレイヤーで、Shift も押しておらず、案内(アンロックや
 * エラー)も出ていないときだけ。ほかのレイヤーに入った瞬間に濃く戻す。
 */
export function overlayFaded(state: {
  autoFade: boolean
  shownLayer: number
  shift: boolean
  status: string
  error: string | null
}): boolean {
  return (
    state.autoFade &&
    state.status === 'ready' &&
    state.error === null &&
    state.shownLayer === 0 &&
    !state.shift
  )
}

/**
 * 薄くしているかを main に伝え、後ろのぼかしを合わせる。図が薄くなり始めるのは FADE_DELAY_MS 後
 * (App の transition)なので、外すのも同じだけ待つ。濃く戻すときはすぐ入れる。
 */
export function useOverlayBlurSync(overlay: boolean, faded: boolean): void {
  useEffect(() => {
    if (!overlay) return
    if (!faded) {
      window.api?.setOverlayBlurActive(true)
      return
    }
    const timer = setTimeout(() => window.api?.setOverlayBlurActive(false), FADE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [overlay, faded])
}
