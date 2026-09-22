/**
 * アンロック中の案内。
 *
 * matrix state はアンロックしないと取れない(docs/PROTOCOL.md §2)。
 * 押下を読むにはこれしか道が無いので、ロックを見つけたら自動で始める。
 * ここは押すべきキーと進み具合を見せるだけ ― ボタンは置かない。
 * (オーバーレイはクリックが透過するので、そもそも押せない)
 */
import { Fragment, type JSX } from 'react'
import type { UnlockState } from '../session/keyboardSession'

export interface UnlockPanelProps {
  unlock: UnlockState
  /**
   * 押すキーの名前(ベースレイヤーの表示)。以前は「図で色が付いているキー」とだけ書いていて、
   * 実際には白い枠だったので、どれのことか分かりにくかった。渡さなければ図を指す言い方に戻る。
   */
  keyNames?: readonly string[]
  /** モックのとき。キーはクリックで押したままにできる。 */
  mock?: boolean
}

/** [Tab] と [Q]、[A]・[B] と [C] のように、キーを 1 つずつ枠に入れて並べる。 */
function KeyNames({ names }: { names: readonly string[] }): JSX.Element {
  return (
    <>
      {names.map((name, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同じ名前のキーが 2 つあり得る。並びは変わらない
        <Fragment key={i}>
          {i > 0 && (i === names.length - 1 ? ' と ' : '・')}
          <kbd className="rounded-md border border-unlock px-1.5 font-sans">{name}</kbd>
        </Fragment>
      ))}
    </>
  )
}

export function UnlockPanel({
  unlock,
  keyNames = [],
  mock = false
}: UnlockPanelProps): JSX.Element {
  const progress = unlock.max > 0 ? (unlock.max - unlock.counter) / unlock.max : 0
  const named = keyNames.length > 0 && keyNames.every(Boolean)

  return (
    // 狭いウィンドウでは説明を隠し、見出しとバーだけにする(図に使える高さを残す)
    <div className="rounded-lg border border-unlock bg-surface px-3 py-2 md:px-4 md:py-3">
      <p className="text-xs font-semibold md:text-sm">
        {named ? (
          <>
            <KeyNames names={keyNames} /> {keyNames.length > 1 ? 'を同時に、' : 'を、'}
            バーが埋まるまで押し続ける
          </>
        ) : (
          '図で白い破線が回っているキーを、バーが埋まるまで押し続ける'
        )}
      </p>
      <p className="mt-1 text-xs text-muted max-md:hidden">
        押しているキーを読むには Vial のアンロックが要る。図では白い破線が回っているキー。
        押しても光らないが、バーが進んでいれば効いている。離すとやり直しになる。
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
