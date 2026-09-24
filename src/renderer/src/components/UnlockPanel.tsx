/**
 * アンロック中の案内。
 *
 * matrix stateはアンロックしないと取れない(docs/PROTOCOL.md §2)。
 * 押下を読むにはこれしか道が無いので、ロックを見つけたら自動で始める。
 * ここは押すべきキーと進み具合を見せるだけで、ボタンは置かない
 * (オーバーレイはクリックが透過するので、そもそも押せない)。
 */
import { Fragment, type JSX } from 'react'
import { messages } from '../messages'
import type { UnlockState } from '../session/keyboardSession'

export interface UnlockPanelProps {
  unlock: UnlockState
  /**
   * 押すキーの名前(ベースレイヤーの表示)。渡さなければ「図で白い破線が回っているキー」と、
   * 図を指す言い方にする。
   */
  keyNames?: readonly string[]
  /** モックのとき。キーはクリックで押したままにできる。 */
  mock?: boolean
}

/** [Tab]と[Q]、[A]・[B]と[C]のように、キーを1つずつ枠に入れて並べる。 */
function KeyNames({ names }: { names: readonly string[] }): JSX.Element {
  return (
    <>
      {names.map((name, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同じ名前のキーが2つあり得る。並びは変わらない
        <Fragment key={i}>
          {i > 0 && (i === names.length - 1 ? messages.unlock.and : messages.unlock.separator)}
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
            <KeyNames names={keyNames} />{' '}
            {keyNames.length > 1 ? messages.unlock.pressTogether : messages.unlock.pressOne}
            {messages.unlock.untilFull}
          </>
        ) : (
          messages.unlock.pressHighlighted
        )}
      </p>
      <p className="mt-1 text-xs text-muted max-md:hidden">
        {messages.unlock.explain}
        {mock && messages.unlock.mockHint}
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
