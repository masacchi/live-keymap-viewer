/** Vialデバイスが複数見つかったときの選択。mainのselect-hid-deviceから呼ばれる。 */
import type { JSX } from 'react'
import type { HidCandidate } from '../../../shared/ipc'
import { messages } from '../messages'
import { Button } from './ui/Button'

export interface DevicePickerProps {
  devices: HidCandidate[]
  onChoose: (deviceId: string | null) => void
}

export function DevicePicker({ devices, onChoose }: DevicePickerProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-ground/80">
      {/* オーバーレイから接続したときも押せるように、透過を切る(OverlayControls) */}
      <div data-interactive className="w-96 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm font-semibold">{messages.devicePicker.title}</p>
        <ul className="mt-3 space-y-1.5">
          {devices.map((device) => (
            <li key={device.deviceId}>
              <button
                type="button"
                onClick={() => onChoose(device.deviceId)}
                className="w-full rounded-md bg-surface-2 px-3 py-2 text-left text-xs hover:bg-line-soft"
              >
                <span className="font-medium">{device.name || messages.devicePicker.unnamed}</span>
                <span className="ml-2 text-muted">
                  {messages.settings.deviceId(device.vendorId, device.productId)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" onClick={() => onChoose(null)} className="mt-3 w-full">
          {messages.devicePicker.cancel}
        </Button>
      </div>
    </div>
  )
}
