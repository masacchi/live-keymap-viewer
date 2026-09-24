/**
 * 図の代わり・図の上に出す、接続まわりの表示(エラーの帯と、未接続の画面)。
 *
 * どちらもオーバーレイで押せるようにdata-interactiveを付ける(OverlayControls)。
 */
import type { JSX } from 'react'
import { messages } from '../messages'
import { Button } from './ui/Button'

export function ErrorBanner({
  message,
  reconnecting,
  onRetry
}: {
  message: string
  /** 自動で繋ぎ直そうとしているか。そのあいだはボタンを出さない。 */
  reconnecting: boolean
  onRetry: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-xs text-ink">
      <span className="min-w-0 flex-1">{message}</span>
      {reconnecting ? (
        <span className="shrink-0 text-muted">{messages.error.reconnecting}</span>
      ) : (
        <Button size="sm" data-interactive onClick={onRetry} className="shrink-0">
          {messages.error.retry}
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  onConnect,
  onMock
}: {
  onConnect: () => void
  onMock: () => void
}): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted">{messages.empty.lead}</p>
      <div data-interactive className="flex gap-2">
        <Button variant="primary" size="lg" onClick={onConnect}>
          {messages.empty.connect}
        </Button>
        <Button size="lg" onClick={onMock}>
          {messages.empty.mock}
        </Button>
      </div>
    </div>
  )
}
