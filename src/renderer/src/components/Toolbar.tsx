import type { JSX } from 'react'
import type { ConnectionStatus } from '../hooks/useVialKeyboard'
import type { LabelMode } from '../keycodes/labels'

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
  // 接続の操作は、未接続なら画面の中央、エラーならエラー表示の中に出す(ここには置かない)
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line-soft)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block size-2 rounded-full ${STATUS_COLOR[status]}`} />
        <span className="text-xs text-[var(--muted)]">{STATUS_TEXT[status]}</span>
        {deviceLabel && (
          <span className="text-xs font-medium text-[var(--ink)]">{deviceLabel}</span>
        )}
      </div>

      {displayLayer !== null && (
        <div className="flex items-center gap-2">
          <span
            className="rounded-md px-3 py-1 text-lg font-bold leading-none text-neutral-900 transition-colors"
            style={{ backgroundColor: `var(--layer-${displayLayer % 10})` }}
          >
            L{displayLayer}
            {displayLayerName && (
              <span className="ml-1.5 text-sm font-semibold">{displayLayerName}</span>
            )}
          </span>
          {shift && (
            <span className="rounded bg-[var(--ink)] px-1.5 py-0.5 text-[11px] font-bold leading-none text-neutral-900">
              Shift
            </span>
          )}
        </div>
      )}

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

        {/* アンロック中や読み込み中は読み直せない(KeyboardSession.reload が何もしない)ので出さない */}
        {status === 'ready' && (
          <Button onClick={onReload}>{reloading ? '読み込み中…' : 'キーマップ再読み込み'}</Button>
        )}

        {/* エラーでも出す。繋ぎ直しを待っているときに、それを止める手段になる */}
        {status !== 'idle' && <Button onClick={onDisconnect}>切断</Button>}
      </div>
    </header>
  )
}
