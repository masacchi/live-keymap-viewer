/**
 * アンロック中の案内。
 *
 * matrix state はアンロックしないと取れない(docs/PROTOCOL.md §2)。
 * 押下を読むにはこれしか道が無いので、ロックを見つけたら自動で始める。
 * ここは押すべきキーと進み具合を見せるだけ ― ボタンは置かない。
 * (オーバーレイはクリックが透過するので、そもそも押せない)
 */
import type { JSX } from 'react'
import type { UnlockState } from '../session/keyboardSession'

export interface UnlockPanelProps {
  unlock: UnlockState
}

export function UnlockPanel({ unlock }: UnlockPanelProps): JSX.Element {
  const progress = unlock.max > 0 ? (unlock.max - unlock.counter) / unlock.max : 0

  return (
    <div className="rounded-lg border border-[var(--layer-4)] bg-[var(--surface)] px-4 py-3">
      <p className="text-sm font-semibold">
        図で色が付いているキーを、バーが埋まるまで押し続ける
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        押しているキーを読むには Vial のアンロックが要る。離すとやり直しになる。
        解除したままにしたくなければ、使い終わったらキーボードを挿し直す。
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--line-soft)]">
        <div
          className="h-full rounded-full bg-[var(--layer-4)] transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  )
}
