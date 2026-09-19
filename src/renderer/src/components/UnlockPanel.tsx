/**
 * アンロックの案内。
 *
 * matrix state はアンロックしないと取れない(docs/PROTOCOL.md §2)。
 * 押すべきキーは図の上で色を変えて示し、進捗はカウンタから出す。
 */
import type { JSX } from 'react'
import type { UnlockState } from '../hooks/useVialKeyboard'

export interface UnlockPanelProps {
  unlock: UnlockState
  unlocking: boolean
  onStart: () => void
}

export function UnlockPanel({ unlock, unlocking, onStart }: UnlockPanelProps): JSX.Element {
  const progress = unlock.max > 0 ? (unlock.max - unlock.counter) / unlock.max : 0

  return (
    <div className="rounded-lg border border-[var(--layer-4)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">キーボードがロックされている</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            押しているキーを読むには Vial のアンロックが要る。
            {unlocking
              ? ' 図で色が付いているキーを、バーが埋まるまで押し続ける。'
              : ' 「アンロックを始める」を押してから、図で色が付いているキーを押し続ける。'}
          </p>
        </div>
        {!unlocking && (
          <button
            type="button"
            onClick={onStart}
            className="shrink-0 rounded-md bg-[var(--layer-4)] px-3 py-1.5 text-xs font-semibold text-neutral-900"
          >
            アンロックを始める
          </button>
        )}
      </div>

      {unlocking && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--line-soft)]">
          <div
            className="h-full rounded-full bg-[var(--layer-4)] transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
