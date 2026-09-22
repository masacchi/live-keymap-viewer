import type { JSX } from 'react'
import type { ConnectionStatus } from '../hooks/useVialKeyboard'
import type { LabelMode } from '../keycodes/labels'
import { cn } from '../lib/cn'
import { layerColor } from '../lib/theme'
import { Button } from './ui/Button'

export interface ToolbarProps {
  status: ConnectionStatus
  deviceLabel: string | null
  /** 表示しているレイヤー。キーボードを読み込むまでは null(出さない)。 */
  displayLayer: number | null
  /** そのレイヤーの名前。無ければ番号だけ。 */
  displayLayerName?: string
  /** Shift が効いているか(図では Shift で入る文字を目立たせている)。 */
  shift: boolean
  labelMode: LabelMode
  windowMode: 'normal' | 'overlay'
  reloading: boolean
  onReload: () => void
  onDisconnect: () => void
  onLabelMode: (mode: LabelMode) => void
  onToggleWindowMode: () => void
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: '未接続',
  connecting: '接続中…',
  loading: '設定を読み込み中…',
  unlocking: 'アンロック中…',
  ready: '接続済み',
  error: 'エラー'
}

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  idle: 'bg-faint',
  connecting: 'bg-warn',
  loading: 'bg-warn',
  unlocking: 'bg-warn',
  ready: 'bg-ok',
  error: 'bg-danger'
}

export function Toolbar({
  status,
  deviceLabel,
  displayLayer,
  displayLayerName,
  shift,
  labelMode,
  windowMode,
  reloading,
  onReload,
  onDisconnect,
  onLabelMode,
  onToggleWindowMode
}: ToolbarProps): JSX.Element {
  // 接続の操作は、未接続なら画面の中央、エラーならエラー表示の中に出す(ここには置かない)。
  // 狭いウィンドウでも 1 行に収める。折り返すと図に使える高さが減るので、
  // 幅が足りなければ状態の文字や補足を隠す(状態は丸の色と、丸に重ねた説明で分かる)
  const statusText = [STATUS_TEXT[status], deviceLabel].filter(Boolean).join(' ')
  return (
    <header className="flex items-center gap-2 border-b border-line-soft px-2 py-2 md:gap-3 md:px-4 md:py-2.5">
      <div className="flex min-w-0 items-center gap-2" title={statusText}>
        <span className={cn('inline-block size-2 shrink-0 rounded-full', STATUS_COLOR[status])} />
        <span className="shrink-0 text-xs text-muted max-md:hidden">{STATUS_TEXT[status]}</span>
        {deviceLabel && (
          <span className="truncate text-xs font-medium text-ink max-md:hidden">{deviceLabel}</span>
        )}
      </div>

      {displayLayer !== null && (
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate rounded-md px-2 py-1 text-lg font-bold leading-none text-ink-inverse transition-colors md:px-3"
            style={{ backgroundColor: layerColor(displayLayer) }}
          >
            L{displayLayer}
            {displayLayerName && (
              <span className="ml-1.5 text-sm font-semibold">{displayLayerName}</span>
            )}
          </span>
          {shift && (
            <span className="rounded-md bg-ink px-1.5 py-0.5 text-2xs font-bold leading-none text-ink-inverse">
              Shift
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
        {/* 切り替えは枠でひとまとめにし、選んでいる方だけ明るくする */}
        <div className="flex overflow-hidden rounded-md border border-line-soft">
          {(['jis', 'us'] as const).map((mode) => (
            <Button
              key={mode}
              onClick={() => onLabelMode(mode)}
              selected={labelMode === mode}
              aria-pressed={labelMode === mode}
              className="rounded-none"
            >
              {mode.toUpperCase()}
            </Button>
          ))}
        </div>

        <Button onClick={onToggleWindowMode}>
          {windowMode === 'overlay' ? '通常ウィンドウへ' : 'オーバーレイへ'}
          <span className="text-2xs text-muted max-lg:hidden">Ctrl+Alt+K</span>
        </Button>

        {/* アンロック中や読み込み中は読み直せない(KeyboardSession.reload が何もしない)ので出さない */}
        {status === 'ready' && (
          <Button onClick={onReload}>
            {reloading ? (
              '読み込み中…'
            ) : (
              <>
                <span className="max-md:hidden">キーマップ再読み込み</span>
                <span className="md:hidden">再読込</span>
              </>
            )}
          </Button>
        )}

        {/* エラーでも出す。繋ぎ直しを待っているときに、それを止める手段になる */}
        {status !== 'idle' && <Button onClick={onDisconnect}>切断</Button>}
      </div>
    </header>
  )
}
