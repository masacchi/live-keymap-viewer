import type { JSX } from 'react'
import { layerColor } from '../lib/theme'
import { Button } from './ui/Button'

/**
 * プレビュー中の札。図の縁の上に重ねる。以前は一覧の横に小さく書いていて、図を見ていると
 * 気づかなかった。固定しているときだけ「戻る」を出す(乗せているだけなら外せば戻る)。
 */
export function PreviewNotice({
  layer,
  name,
  pinned,
  onExit
}: {
  layer: number
  name?: string
  pinned: boolean
  onExit: () => void
}): JSX.Element {
  return (
    <div
      className="absolute -top-3.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border-2 bg-ground py-0.5 pl-3 pr-1 text-2xs text-ink"
      style={{ borderColor: layerColor(layer) }}
    >
      <span>
        <b className="font-semibold">
          L{layer}
          {name ? ` ${name}` : ''}
        </b>{' '}
        をプレビュー中
        <span className="text-muted max-md:hidden">
          {pinned ? '(キーを押すか Esc で戻る)' : '(ポインタを外すと戻る)'}
        </span>
      </span>
      {pinned ? (
        <Button size="sm" onClick={onExit} className="rounded-full py-0.5">
          戻る
        </Button>
      ) : (
        <span className="pr-2" />
      )}
    </div>
  )
}
