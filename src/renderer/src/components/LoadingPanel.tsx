/**
 * 接続中・読み込み中の表示。
 *
 * USBなら一瞬で終わるが、Bluetoothでは1往復 約0.5秒で、読み込み全体が数十秒かかる。
 * 以前はそのあいだ未接続の画面(接続ボタンつき)が出ていて、止まっているのか進んでいるのか
 * 分からなかった。段ごとに「何往復のうち何往復目か」を出す。
 */
import type { JSX } from 'react'
import type { LoadProgress } from '../hid/vial'
import { messages } from '../messages'

export interface LoadingPanelProps {
  deviceLabel: string | null
  progress: LoadProgress | null
}

export function LoadingPanel({ deviceLabel, progress }: LoadingPanelProps): JSX.Element {
  const ratio = progress && progress.total > 0 ? progress.done / progress.total : 0

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-ink">
        {progress ? messages.loading.reading(deviceLabel) : messages.loading.connecting}
      </p>
      {progress ? (
        <div className="w-64 max-w-full">
          <div className="flex justify-between text-xs text-muted">
            <span>{messages.loading.stages[progress.stage]}</span>
            <span className="tabular-nums">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-ink transition-[width] duration-100"
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
