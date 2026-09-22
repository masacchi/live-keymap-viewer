/**
 * 通常ウィンドウのツールバー。常に 1 行。
 *
 *   [● Cornix LP ▾] [L0] [L1 BS 長押し] … +5 空 [Ctrl Shift Alt Win]   [JIS|US] [@ 記号の出し方] [オーバーレイへ] [設定]
 *
 * - 左: 接続の状態とデバイス名。押すと、使う頻度の低い操作(読み直し・切断)のメニューが開く
 * - 中: レイヤーの一覧(LayerStrip)。いま出しているレイヤーは塗って輪を付ける。以前はこの横に
 *   大きな「L0」の札があり、下の段の一覧と同じことを 2 回言っていた。一覧をここに入れて 1 段減らし、
 *   そのぶん図を大きくする
 *   の横に、いま効いているモディファイア
 * - 右: 表記の切り替え・記号の出し方・オーバーレイ・設定
 *
 * 接続の操作は、未接続なら画面の中央、エラーならエラー表示の中に出す(ここには置かない)。
 * 幅が足りなければ状態の文字やレイヤーの補足を隠す(状態は丸の色と、ボタンの説明で分かる)。
 */
import type { JSX, ReactNode } from 'react'
import type { ConnectionStatus } from '../hooks/useVialKeyboard'
import type { LabelMode } from '../keycodes/labels'
import { cn } from '../lib/cn'
import { messages } from '../messages'
import { ModifierBadges } from './ModifierBadges'
import { Button, buttonVariants } from './ui/Button'
import { SlidersIcon } from './ui/icons'
import { Menu, MenuItem } from './ui/Menu'
import { Popover } from './ui/Popover'

export interface ToolbarProps {
  status: ConnectionStatus
  deviceLabel: string | null
  /** レイヤーの一覧。キーボードを読み込むまでは渡さない。 */
  layers?: ReactNode
  /** 設定パネルの中身(右端の「設定」から開く)。 */
  settings: ReactNode
  /** 記号の出し方の中身。閉じる関数を受け取る(記号を選んだら閉じる)。キーボードを読み込むまでは渡さない。 */
  symbols?: (close: () => void) => ReactNode
  /** いま効いているモディファイア(MOD_* ビット)。キーボードを読み込むまでは null(出さない)。 */
  mods: number | null
  labelMode: LabelMode
  windowMode: 'normal' | 'overlay'
  reloading: boolean
  onReload: () => void
  onDisconnect: () => void
  onLabelMode: (mode: LabelMode) => void
  onToggleWindowMode: () => void
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
  layers,
  settings,
  symbols,
  mods,
  labelMode,
  windowMode,
  reloading,
  onReload,
  onDisconnect,
  onLabelMode,
  onToggleWindowMode
}: ToolbarProps): JSX.Element {
  const statusText = reloading ? messages.status.reloading : messages.status[status]
  const title = [statusText, deviceLabel].filter(Boolean).join(' ')
  const statusLabel = (
    <>
      <span className={cn('inline-block size-2 shrink-0 rounded-full', STATUS_COLOR[status])} />
      <span className="shrink-0 text-muted max-md:hidden">{statusText}</span>
      {deviceLabel && (
        <span className="max-w-40 truncate font-medium text-ink max-md:hidden">{deviceLabel}</span>
      )}
    </>
  )

  return (
    <header className="flex items-center gap-2 border-b border-line-soft px-2 py-2 md:gap-3 md:px-4">
      {status === 'idle' ? (
        <div className="flex h-7 min-w-0 shrink-0 items-center gap-2 px-2 text-xs" title={title}>
          {statusLabel}
        </div>
      ) : (
        <Menu label={statusLabel} title={title} className="shrink-0">
          {/* アンロック中や読み込み中は読み直せない(KeyboardSession.reload が何もしない) */}
          <MenuItem onSelect={onReload} disabled={status !== 'ready' || reloading}>
            {messages.deviceMenu.reload}
          </MenuItem>
          {/* エラーでも出す。繋ぎ直しを待っているときに、それを止める手段になる */}
          <MenuItem onSelect={onDisconnect}>{messages.deviceMenu.disconnect}</MenuItem>
        </Menu>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {layers}
        {mods !== null && <ModifierBadges mods={mods} />}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
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

        {symbols && (
          <Popover
            role="dialog"
            align="end"
            title={messages.toolbar.symbols}
            buttonClassName={buttonVariants()}
            label={
              <>
                <span className="font-bold">@</span>
                {/* 既定の幅(1180px)では隠す。出すとレイヤーの一覧が押し出される */}
                <span className="max-xl:hidden">{messages.toolbar.symbols}</span>
              </>
            }
          >
            {symbols}
          </Popover>
        )}

        <Button onClick={onToggleWindowMode} title={messages.toolbar.modeShortcutHint}>
          {windowMode === 'overlay' ? messages.toolbar.toNormal : messages.toolbar.toOverlay}
          <span className="text-2xs text-muted max-xl:hidden">{messages.toolbar.modeShortcut}</span>
        </Button>

        <Popover
          role="dialog"
          align="end"
          title={messages.toolbar.settings}
          buttonClassName={buttonVariants()}
          label={
            <>
              <SlidersIcon />
              <span className="max-md:hidden">{messages.toolbar.settings}</span>
            </>
          }
        >
          {settings}
        </Popover>
      </div>
    </header>
  )
}
