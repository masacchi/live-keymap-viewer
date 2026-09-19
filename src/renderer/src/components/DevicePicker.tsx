/** Vial デバイスが複数見つかったときの選択。main の select-hid-device から呼ばれる。 */
import type { JSX } from 'react'
import type { HidCandidate } from '../../../shared/ipc'

export interface DevicePickerProps {
  devices: HidCandidate[]
  onChoose: (deviceId: string | null) => void
}

export function DevicePicker({ devices, onChoose }: DevicePickerProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60">
      <div className="w-96 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold">接続するキーボードを選ぶ</p>
        <ul className="mt-3 space-y-1.5">
          {devices.map((device) => (
            <li key={device.deviceId}>
              <button
                type="button"
                onClick={() => onChoose(device.deviceId)}
                className="w-full rounded-md bg-[var(--surface-2)] px-3 py-2 text-left text-xs hover:bg-[var(--line-soft)]"
              >
                <span className="font-medium">{device.name || '(名前なし)'}</span>
                <span className="ml-2 text-[var(--muted)]">
                  {`${device.vendorId.toString(16).padStart(4, '0')}:${device.productId
                    .toString(16)
                    .padStart(4, '0')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onChoose(null)}
          className="mt-3 w-full rounded-md px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--line-soft)]"
        >
          やめる
        </button>
      </div>
    </div>
  )
}
