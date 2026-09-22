/**
 * 接続中・読み込み中の表示。
 *
 * USB なら一瞬で終わるが、Bluetooth では 1 往復 約 0.5 秒で、読み込み全体が数十秒かかる。
 * 以前はそのあいだ未接続の画面(接続ボタンつき)が出ていて、止まっているのか進んでいるのか
 * 分からなかった。段ごとに「何往復のうち何往復目か」を出す。
 */
import type { JSX } from 'react'
import type { LoadProgress } from '../hid/vial'

const STAGE_TEXT: Record<LoadProgress['stage'], string> = {
  definition: '配置(定義)',
  keymap: 'キーマップ',
  encoders: 'ノブの割り当て',
  tapDance: 'Tap Dance'
}

export interface LoadingPanelProps {
  deviceLabel: string | null
  progress: LoadProgress | null
}

export function LoadingPanel({ deviceLabel, progress }: LoadingPanelProps): JSX.Element {
  const ratio = progress && progress.total > 0 ? progress.done / progress.total : 0

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-ink">
        {progress ? `${deviceLabel ?? 'キーボード'} を読み込み中` : '接続中…'}
      </p>
      {progress ? (
        <div className="w-64 max-w-full">
          <div className="flex justify-between text-xs text-muted">
            <span>{STAGE_TEXT[progress.stage]}</span>
            <span className="tabular-nums">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-layer-2 transition-[width] duration-100"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        deviceLabel && <p className="text-xs text-muted">{deviceLabel}</p>
      )}
    </div>
  )
}
