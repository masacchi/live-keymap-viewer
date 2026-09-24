import type { JSX, ReactNode } from 'react'
import { layerColor } from '../lib/theme'
import { messages } from '../messages'
import { Button } from './ui/Button'

/**
 * プレビュー中の札。図の縁の上に重ねる。以前は一覧の横に小さく書いていて、図を見ていると
 * 気づかなかった。固定しているときだけ「戻る」を出す(乗せているだけなら外せば戻る)。
 */
export function PreviewNotice({
  layer,
  name,
  pinned,
  onExit,
  hint
}: {
  layer: number
  name?: string
  pinned: boolean
  onExit: () => void
  /** 「@ はL2 + W」のような案内。あれば「プレビュー中」の代わりにこれを出す(記号の出し方)。 */
  hint?: ReactNode
}): JSX.Element {
  return (
    <div
      className="absolute -top-3.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border-2 bg-ground py-0.5 pl-3 pr-1 text-2xs text-ink"
      style={{ borderColor: layerColor(layer) }}
    >
      {hint ?? (
        <span>
          <b className="font-semibold">
            L{layer}
            {name ? ` ${name}` : ''}
          </b>{' '}
          {messages.preview.previewing}
        </span>
      )}
      <span className="-ml-1 text-muted max-md:hidden">
        {pinned ? messages.preview.pinnedHint : messages.preview.hoverHint}
      </span>
      {pinned ? (
        <Button size="sm" onClick={onExit} className="rounded-full py-0.5">
          {messages.preview.back}
        </Button>
      ) : (
        <span className="pr-2" />
      )}
    </div>
  )
}
