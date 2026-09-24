/**
 * 画面が例外で落ちたときの受け皿。
 *
 * オーバーレイは透明なので、Reactが転んで何も描かれないと**画面から消えたように見える**。
 * しかもクリック透過なので、押して確かめることもできない。せめて何が起きたかを出し、
 * 戻る道(通常ウィンドウへ / 読み込み直す)を示す。起きたことはmainのログにも残す
 * (配布ビルドではDevToolsを開けないので、これが唯一の手がかりになる)。
 */
import { Component, type ErrorInfo, type JSX, type ReactNode, useEffect } from 'react'
import { reportError } from '../lib/report'
import { messages } from '../messages'
import { Button } from './ui/Button'

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

function CrashScreen({ message }: { message: string }): JSX.Element {
  useEffect(() => {
    // オーバーレイのクリック透過はOverlayControlsが面倒を見ているが、その木ごと落ちている。
    // ここで透過を切って、このカードを押せるようにする
    window.api?.setIgnoreMouseEvents(false)
  }, [])

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div
        data-interactive
        className="w-full max-w-md space-y-3 rounded-lg border border-danger/50 bg-surface p-4"
      >
        <h1 className="text-sm font-semibold text-ink">{messages.crash.title}</h1>
        <p className="break-words text-2xs text-muted">{message}</p>
        <p className="text-2xs text-muted">{messages.crash.hint}</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {messages.crash.reload}
          </Button>
          <Button onClick={() => void window.api?.toggleMode()}>{messages.crash.toNormal}</Button>
        </div>
      </div>
    </div>
  )
}

interface ErrorBoundaryState {
  message: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: describe(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError(describe(error), info.componentStack ?? undefined)
  }

  render(): ReactNode {
    const { message } = this.state
    return message === null ? this.props.children : <CrashScreen message={message} />
  }
}
