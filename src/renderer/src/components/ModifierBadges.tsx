/**
 * いま効いているモディファイアの印(Ctrl / Shift / Alt / Win)。
 *
 * 以前は Shift だけを出していた。エンジンは Ctrl / Alt / Win も追っている(LayerSnapshot.mods)ので、
 * 4 つとも並べる。MT(長押しで Ctrl)が確定したかどうかも、ここで分かる。
 *
 * 効いていないものも薄く出しておく。点いたときに出てくる形だと、そのたびに横の要素がずれる。
 */
import type { JSX } from 'react'
import { MOD_ALT, MOD_CTRL, MOD_GUI, MOD_SHIFT } from '../keycodes/decode'
import { cn } from '../lib/cn'

const MODIFIERS = [
  { bit: MOD_CTRL, name: 'Ctrl' },
  { bit: MOD_SHIFT, name: 'Shift' },
  { bit: MOD_ALT, name: 'Alt' },
  { bit: MOD_GUI, name: 'Win' }
] as const

export function ModifierBadges({ mods }: { mods: number }): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {MODIFIERS.map(({ bit, name }) => {
        const on = (mods & bit) !== 0
        return (
          <span
            key={name}
            title={on ? `${name} が効いている` : name}
            data-on={on}
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-2xs font-bold leading-none transition-colors',
              on ? 'border-ink bg-ink text-ink-inverse' : 'border-line-soft text-faint'
            )}
          >
            {/* 狭いウィンドウでは頭文字だけ(C / S / A / W) */}
            <span className="md:hidden">{name[0]}</span>
            <span className="max-md:hidden">{name}</span>
            {on && <span className="sr-only">(効いている)</span>}
          </span>
        )
      })}
    </div>
  )
}
