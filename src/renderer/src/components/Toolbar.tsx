import type { JSX } from 'react'
import type { ConnectionStatus } from '../hooks/useVialKeyboard'
import type { LabelMode } from '../keycodes/labels'

export interface ToolbarProps {
  status: ConnectionStatus
  deviceLabel: string | null
  displayLayer: number
  activeLayers: number[]
  labelMode: LabelMode
  windowMode: 'normal' | 'overlay'
  reloading: boolean
  onReload: () => void
  onConnect: () => void
  onConnectMock: () => void
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
  idle: 'bg-neutral-500',
  connecting: 'bg-amber-400',
  loading: 'bg-amber-400',
  unlocking: 'bg-amber-400',
  ready: 'bg-emerald-400',
  error: 'bg-rose-500'
}

function Button({
  children,
  onClick,
  active = false
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-[var(--layer-2)] text-neutral-900'
          : 'bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--line-soft)]'
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function Toolbar({
  status,
  deviceLabel,
  displayLayer,
  activeLayers,
  labelMode,
  windowMode,
  reloading,
  onReload,
  onConnect,
  onConnectMock,
  onDisconnect,
  onLabelMode,
  onToggleWindowMode
}: ToolbarProps): JSX.Element {
  const connected = status !== 'idle' && status !== 'error'

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line-soft)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block size-2 rounded-full ${STATUS_COLOR[status]}`} />
        <span className="text-xs text-[var(--muted)]">{STATUS_TEXT[status]}</span>
        {deviceLabel && (
          <span className="text-xs font-medium text-[var(--ink)]">{deviceLabel}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className="rounded-md px-3 py-1 text-lg font-bold leading-none text-neutral-900 transition-colors"
          style={{ backgroundColor: `var(--layer-${displayLayer % 10})` }}
        >
          L{displayLayer}
        </span>
        {activeLayers.length > 1 && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
            重なり
            {activeLayers.map((n) => (
              <span
                key={n}
                className="rounded px-1 font-semibold text-neutral-900"
                style={{ backgroundColor: `var(--layer-${n % 10})` }}
              >
                L{n}
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-[var(--line-soft)]">
          <Button onClick={() => onLabelMode('jis')} active={labelMode === 'jis'}>
            JIS
          </Button>
          <Button onClick={() => onLabelMode('us')} active={labelMode === 'us'}>
            US
          </Button>
        </div>

        <Button onClick={onToggleWindowMode}>
          {windowMode === 'overlay' ? '通常ウィンドウへ' : 'オーバーレイへ'}
          <span className="ml-1.5 text-[10px] text-[var(--muted)]">Ctrl+Alt+K</span>
        </Button>

        {connected && (
          <Button onClick={onReload}>{reloading ? '読み込み中…' : 'キーマップ再読み込み'}</Button>
        )}

        {connected ? (
          <Button onClick={onDisconnect}>切断</Button>
        ) : (
          <>
            <Button onClick={onConnect}>キーボードに接続</Button>
            <Button onClick={onConnectMock}>モックで試す</Button>
          </>
        )}
      </div>
    </header>
  )
}
