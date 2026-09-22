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
  /** モックのとき。キーはクリックで押したままにできる。 */
  mock?: boolean
}

export function UnlockPanel({ unlock, mock = false }: UnlockPanelProps): JSX.Element {
  const progress = unlock.max > 0 ? (unlock.max - unlock.counter) / unlock.max : 0

  return (
    // 狭いウィンドウでは説明を隠し、見出しとバーだけにする(図に使える高さを残す)
    <div className="rounded-lg border border-unlock bg-surface px-3 py-2 md:px-4 md:py-3">
      <p className="text-xs font-semibold md:text-sm">
        図で色が付いているキーを、バーが埋まるまで押し続ける
      </p>
      <p className="mt-1 text-xs text-muted max-md:hidden">
        押しているキーを読むには Vial のアンロックが要る。離すとやり直しになる。
        解除したままにしたくなければ、使い終わったらキーボードを挿し直す。
        {mock && ' (モックでは、キーをクリックすると押したままになる。もう一度で離す)'}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-soft md:mt-3">
        <div
          className="h-full rounded-full bg-unlock transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  )
}
