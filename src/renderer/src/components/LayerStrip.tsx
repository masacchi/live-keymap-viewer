/**
 * レイヤーの一覧。有効なレイヤーは塗り、いま図に出しているレイヤーには輪を付ける。
 *
 * 押すとそのレイヤーを図に出す(プレビュー)。キーマップを覚えるときに、レイヤーキーを
 * 押さえ続けなくても中身を見られるように。次にキーを押すと実際の表示に戻る(App.tsx)。
 * オーバーレイはクリックが透過するので、通常ウィンドウでだけ出す。
 *
 * ダブルクリックでレイヤーに名前を付けられる(Enter で決定、Esc でやめる、空にすると消す)。
 */
import { type JSX, useEffect, useRef, useState } from 'react'
import { LAYER_NAME_MAX_LENGTH } from '../../../shared/settings'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'

export interface LayerStripProps {
  /** レイヤーの数。 */
  count: number
  /** 実際に有効なレイヤー(プレビューとは関係なく、キーボードの状態)。 */
  activeLayers: readonly number[]
  /** 図に出しているレイヤー(プレビュー中ならそのレイヤー)。 */
  shownLayer: number
  /** プレビュー中のレイヤー。していなければ null。 */
  preview: number | null
  /** レイヤーの名前(番号順、'' は名前なし)。 */
  names?: readonly string[]
  onPreview: (layer: number | null) => void
  /** 名前を付けた(空なら消した)とき。渡さなければ名前は付けられない。 */
  onRename?: (layer: number, name: string) => void
}

export function LayerStrip({
  count,
  activeLayers,
  shownLayer,
  preview,
  names = [],
  onPreview,
  onRename
}: LayerStripProps): JSX.Element {
  const active = new Set(activeLayers)
  /** 名前を編集しているレイヤー。 */
  const [editing, setEditing] = useState<number | null>(null)

  return (
    // 低いウィンドウでは隠す。図に使える高さの方が大事で、プレビューや名前付けは広げてから使えば足りる
    <div className="flex flex-wrap items-center gap-1.5 [@media(max-height:420px)]:hidden">
      {Array.from({ length: count }, (_, layer) => {
        const color = layerColor(layer)
        const filled = active.has(layer)
        if (editing === layer && onRename) {
          return (
            <NameInput
              // biome-ignore lint/suspicious/noArrayIndexKey: レイヤー番号そのものが識別子
              key={layer}
              layer={layer}
              initial={names[layer] ?? ''}
              color={color}
              onDone={(name) => {
                setEditing(null)
                if (name !== null) onRename(layer, name)
              }}
            />
          )
        }
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: レイヤー番号そのものが識別子
            key={layer}
            type="button"
            title={
              (preview === layer ? '実際の表示に戻る' : `L${layer} を見る(キーを押すと戻る)`) +
              (onRename ? '。ダブルクリックで名前を付ける' : '')
            }
            onClick={() => onPreview(preview === layer ? null : layer)}
            onDoubleClick={() => onRename && setEditing(layer)}
            className={cn(
              'rounded border px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors',
              filled ? 'text-neutral-900' : 'text-muted hover:text-ink',
              // 輪は box-shadow で描かれるので、縁取りは border で付ける(style で box-shadow を触らない)
              shownLayer === layer && 'ring-2 ring-ink ring-offset-2 ring-offset-ground'
            )}
            style={{
              backgroundColor: filled ? color : 'transparent',
              borderColor: filled ? color : `color-mix(in srgb, ${color} 55%, transparent)`
            }}
          >
            L{layer}
            {names[layer] && <span className="ml-1 font-medium max-md:hidden">{names[layer]}</span>}
          </button>
        )
      })}
      {preview !== null && (
        <span className="ml-1 flex items-center gap-2 text-xs text-muted">
          <span className="max-md:hidden">L{preview} をプレビュー中(キーを押すか Esc で戻る)</span>
          <button
            type="button"
            onClick={() => onPreview(null)}
            className="rounded bg-surface px-2 py-0.5 font-medium text-ink hover:bg-line-soft"
          >
            戻る
          </button>
        </span>
      )}
    </div>
  )
}

/** レイヤー名の入力欄。Enter か欄の外で決定、Esc でやめる(onDone に null)。 */
function NameInput({
  layer,
  initial,
  color,
  onDone
}: {
  layer: number
  initial: string
  color: string
  onDone: (name: string | null) => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  // Esc でやめたあと、欄が消えるときの blur で保存してしまわないよう、決まるのは 1 回だけ
  const finished = useRef(false)
  const finish = (name: string | null): void => {
    if (finished.current) return
    finished.current = true
    onDone(name)
  }
  return (
    <input
      ref={ref}
      aria-label={`L${layer} の名前`}
      placeholder={`L${layer} の名前`}
      defaultValue={initial}
      maxLength={LAYER_NAME_MAX_LENGTH}
      onKeyDown={(event) => {
        // App の Esc(プレビューをやめる)まで届かせない
        event.stopPropagation()
        if (event.key === 'Enter') finish(event.currentTarget.value)
        if (event.key === 'Escape') finish(null)
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="w-28 rounded border bg-surface px-2 py-0.5 text-xs text-ink outline-none"
      style={{ borderColor: color }}
    />
  )
}
