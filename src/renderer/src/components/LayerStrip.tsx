/**
 * レイヤーの一覧。有効なレイヤーは塗り、いま図に出しているレイヤーには輪を付ける。
 *
 * 押すとそのレイヤーを図に出す(プレビュー)。キーマップを覚えるときに、レイヤーキーを
 * 押さえ続けなくても中身を見られるように。次にキーを押すと実際の表示に戻る(App.tsx)。
 * オーバーレイはクリックが透過するので、通常ウィンドウでだけ出す。
 */
import type { JSX } from 'react'

export interface LayerStripProps {
  /** レイヤーの数。 */
  count: number
  /** 実際に有効なレイヤー(プレビューとは関係なく、キーボードの状態)。 */
  activeLayers: readonly number[]
  /** 図に出しているレイヤー(プレビュー中ならそのレイヤー)。 */
  shownLayer: number
  /** プレビュー中のレイヤー。していなければ null。 */
  preview: number | null
  onPreview: (layer: number | null) => void
}

export function LayerStrip({
  count,
  activeLayers,
  shownLayer,
  preview,
  onPreview
}: LayerStripProps): JSX.Element {
  const active = new Set(activeLayers)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Array.from({ length: count }, (_, layer) => {
        const color = `var(--layer-${layer % 10})`
        const filled = active.has(layer)
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: レイヤー番号そのものが識別子
            key={layer}
            type="button"
            title={preview === layer ? '実際の表示に戻る' : `L${layer} を見る(キーを押すと戻る)`}
            onClick={() => onPreview(preview === layer ? null : layer)}
            className={[
              'rounded border px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors',
              filled ? 'text-neutral-900' : 'text-[var(--muted)] hover:text-[var(--ink)]',
              // 輪は box-shadow で描かれるので、縁取りは border で付ける(style で box-shadow を触らない)
              shownLayer === layer
                ? 'ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--ground)]'
                : ''
            ].join(' ')}
            style={{
              backgroundColor: filled ? color : 'transparent',
              borderColor: filled ? color : `color-mix(in srgb, ${color} 55%, transparent)`
            }}
          >
            L{layer}
          </button>
        )
      })}
      {preview !== null && (
        <span className="ml-1 flex items-center gap-2 text-xs text-[var(--muted)]">
          L{preview} をプレビュー中(キーを押すか Esc で戻る)
          <button
            type="button"
            onClick={() => onPreview(null)}
            className="rounded bg-[var(--surface)] px-2 py-0.5 font-medium text-[var(--ink)] hover:bg-[var(--line-soft)]"
          >
            戻る
          </button>
        </span>
      )}
    </div>
  )
}
