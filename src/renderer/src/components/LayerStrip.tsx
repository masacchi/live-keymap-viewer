/**
 * レイヤーの一覧(ツールバーの中)。
 *
 * - いま図に出しているレイヤーはその色で塗り、輪を付ける。ほかに有効なレイヤー(L2の下のL0など)は
 *   薄く塗る(すべて同じに塗ると、どれが出ているのか輪でしか分からない)
 * - **そのレイヤーへの行き方**(「Space長押し」など、engine/layerSummary.ts)はツールチップに出す。
 *   番号の横にも並べられるが、既定では出さない(設定のshowLayerTriggers)。常に並べると
 *   ツールバーが詰まり、狭いウィンドウでは横に流れて肝心のレイヤーが見切れる
 * - 中身の無いレイヤー(CornixのL5〜L9)は「+5」に畳む。有効になったら畳んでいても出す
 * - ポインタを乗せているあいだ、そのレイヤーを図に出す(プレビュー)。押すとプレビューのまま固定し、
 *   もう一度押すか、キーを押すかEscで戻る(App.tsx)。キーマップを覚えるときに、レイヤーキーを
 *   押さえ続けなくても中身を見られるように。オーバーレイはクリックが透過するので出さない
 * - ダブルクリックでレイヤーに名前を付けられる(Enterで決定、Escでやめる、空にすると消す)
 */
import { type JSX, useEffect, useRef, useState } from 'react'
import { LAYER_NAME_MAX_LENGTH } from '../../../shared/settings'
import { describeTrigger, type LayerSummary } from '../engine/layerSummary'
import type { LabelContext, LabelMode } from '../keycodes/labels'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'
import { messages } from '../messages'

export interface LayerStripProps {
  summaries: readonly LayerSummary[]
  /** 実際に有効なレイヤー(プレビューとは関係なく、キーボードの状態)。 */
  activeLayers: readonly number[]
  /** 図に出しているレイヤー(プレビュー中ならそのレイヤー)。 */
  shownLayer: number
  /** 押して固定したプレビュー。していなければnull。 */
  preview: number | null
  /** レイヤーの名前(番号順、''は名前なし)。 */
  names?: readonly string[]
  labelMode: LabelMode
  labelContext: LabelContext
  /** 押したとき。固定のプレビューを切り替える(nullで戻る)。 */
  onPreview: (layer: number | null) => void
  /** ポインタを乗せた / 外したとき(外したらnull)。 */
  onHover: (layer: number | null) => void
  /** 名前を付けた(空なら消した)とき。渡さなければ名前は付けられない。 */
  onRename?: (layer: number, name: string) => void
  /** 番号の横に行き方を並べるか。出さなくてもツールチップには入る。 */
  showTriggers?: boolean
}

export function LayerStrip({
  summaries,
  activeLayers,
  shownLayer,
  preview,
  names = [],
  labelMode,
  labelContext,
  onPreview,
  onHover,
  onRename,
  showTriggers = false
}: LayerStripProps): JSX.Element {
  const active = new Set(activeLayers)
  /** 名前を編集しているレイヤー。 */
  const [editing, setEditing] = useState<number | null>(null)
  /** 空のレイヤーも並べるか。 */
  const [showBlank, setShowBlank] = useState(false)

  // 空でも、いま効いている・出している・編集しているレイヤーは隠さない
  const visible = (s: LayerSummary): boolean =>
    !s.blank || showBlank || active.has(s.layer) || s.layer === shownLayer || s.layer === editing
  const hiddenBlank = summaries.filter((s) => !visible(s))
  const blankCount = summaries.filter((s) => s.blank).length

  return (
    // 幅が足りなければ横に流す(折り返すとツールバーが2行になり、図に使える高さが減る)。
    // 流せる枠は縦にもはみ出しを切るので、輪(ring-offset)のぶん余白を取り、負のマージンで高さを戻す
    <div className="-my-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
      {summaries.filter(visible).map(({ layer, triggers }) => {
        const color = layerColor(layer)
        if (editing === layer && onRename) {
          return (
            <NameInput
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
        const shown = shownLayer === layer
        const how = triggers[0] ? describeTrigger(triggers[0], labelMode, labelContext) : null
        return (
          <button
            key={layer}
            type="button"
            aria-pressed={preview === layer}
            title={[
              messages.layerStrip.chipTitle(layer, how),
              preview === layer ? messages.layerStrip.pinnedHint : messages.layerStrip.unpinnedHint,
              onRename ? messages.layerStrip.renameHint : null
            ]
              .filter(Boolean)
              .join(messages.layerStrip.joiner)}
            // クリックでフォーカスを取らない。取ったままだと、このあと実機でSpace / Enterを押したとき
            // ブラウザがこのボタンを押したことにして、キーを押して戻したプレビューがまた固定される
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPreview(preview === layer ? null : layer)}
            onDoubleClick={() => onRename && setEditing(layer)}
            onMouseEnter={() => onHover(layer)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(layer)}
            onBlur={() => onHover(null)}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold',
              'tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink/60',
              shown
                ? 'text-ink-inverse ring-2 ring-ink ring-offset-2 ring-offset-ground'
                : 'text-ink hover:brightness-125'
            )}
            // 出している: 塗る / ほかに有効: 薄く塗る / 無効: 枠だけ
            style={{
              backgroundColor: shown
                ? color
                : active.has(layer)
                  ? `color-mix(in srgb, ${color} 28%, transparent)`
                  : 'transparent',
              borderColor:
                shown || active.has(layer) ? color : `color-mix(in srgb, ${color} 55%, transparent)`
            }}
          >
            <span>L{layer}</span>
            {names[layer] && <span className="font-medium max-md:hidden">{names[layer]}</span>}
            {showTriggers && how && (
              <span
                className={cn(
                  'text-2xs font-normal max-lg:hidden',
                  shown ? 'opacity-75' : 'text-muted'
                )}
              >
                {how}
              </span>
            )}
          </button>
        )
      })}
      {blankCount > 0 && (hiddenBlank.length > 0 || showBlank) && (
        <button
          type="button"
          onClick={() => setShowBlank((on) => !on)}
          title={
            showBlank
              ? messages.layerStrip.hideBlankTitle
              : messages.layerStrip.showBlankTitle(hiddenBlank.map((s) => s.layer))
          }
          className="h-7 shrink-0 rounded-md px-1.5 text-2xs text-muted hover:bg-line-soft hover:text-ink"
        >
          {showBlank
            ? messages.layerStrip.hideBlank
            : messages.layerStrip.showBlank(hiddenBlank.length)}
        </button>
      )}
    </div>
  )
}

/** レイヤー名の入力欄。Enterか欄の外で決定、Escでやめる(onDoneにnull)。 */
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
  // Escでやめたあと、欄が消えるときのblurで保存してしまわないよう、決まるのは1回だけ
  const finished = useRef(false)
  const finish = (name: string | null): void => {
    if (finished.current) return
    finished.current = true
    onDone(name)
  }
  return (
    <input
      ref={ref}
      aria-label={messages.layerStrip.nameLabel(layer)}
      placeholder={messages.layerStrip.nameLabel(layer)}
      defaultValue={initial}
      maxLength={LAYER_NAME_MAX_LENGTH}
      onKeyDown={(event) => {
        // AppのEsc(プレビューをやめる)まで届かせない
        event.stopPropagation()
        if (event.key === 'Enter') finish(event.currentTarget.value)
        if (event.key === 'Escape') finish(null)
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="h-7 w-28 shrink-0 rounded-md border bg-surface px-2 text-xs text-ink outline-none"
      style={{ borderColor: color }}
    />
  )
}
