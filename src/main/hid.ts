/**
 * WebHID の許可まわり。
 *
 * HID そのものは renderer の WebHID で扱う(node-hid のネイティブビルドを避けるため)。
 * main がやるのは、Electron の既定では出ない選択ダイアログの代わりと、
 * 一度許可したデバイスを次の起動でも使えるようにすることだけ。
 */
import { session } from 'electron'
import { type HidCandidate, IPC } from '../shared/ipc'
import { isDeviceGranted, rememberDevice } from './settings'
import type { WindowManager } from './windows'

/** Vial の raw HID インターフェース(docs/PROTOCOL.md §1)。 */
const VIAL_USAGE_PAGE = 0xff60
const VIAL_USAGE = 0x61

function isVialDevice(device: Electron.HIDDevice): boolean {
  return device.collections.some(
    (collection) => collection.usagePage === VIAL_USAGE_PAGE && collection.usage === VIAL_USAGE
  )
}

export class HidPermissions {
  /** select-hid-device のコールバック。renderer が選ぶまで預かる。 */
  private pending: ((deviceId: string | null) => void) | null = null

  constructor(private readonly windows: WindowManager) {}

  install(): void {
    const ses = session.defaultSession

    // renderer が navigator.hid を使えるようにする
    ses.setPermissionCheckHandler((_contents, permission) => permission === 'hid')
    ses.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === 'hid')
    )

    // 一度許可したデバイスは、次の起動でも navigator.hid.getDevices() に出す
    ses.setDevicePermissionHandler((details) => {
      if (details.deviceType !== 'hid') return false
      const device = details.device as Electron.HIDDevice
      return isDeviceGranted(device.vendorId, device.productId)
    })

    ses.on('select-hid-device', (event, details, callback) => {
      event.preventDefault()
      const candidates = details.deviceList.filter(isVialDevice)

      const choose = (device: Electron.HIDDevice | undefined): void => {
        if (device) {
          rememberDevice({
            vendorId: device.vendorId,
            productId: device.productId,
            name: device.name
          })
        }
        callback(device?.deviceId)
      }

      if (candidates.length <= 1) {
        choose(candidates[0])
        return
      }

      // 前の選択が宙に浮いていたら、取り消してから次へ。
      // 放っておくと前の requestDevice() が永遠に終わらない。
      this.resolve(null)
      this.pending = (deviceId) => choose(candidates.find((d) => d.deviceId === deviceId))
      this.windows.send(
        IPC.hidChooseDevice,
        candidates.map(
          (d): HidCandidate => ({
            deviceId: d.deviceId,
            name: d.name,
            vendorId: d.vendorId,
            productId: d.productId
          })
        )
      )
    })
  }

  /** renderer で選ばれた(または取り消された)ときに呼ぶ。 */
  resolve(deviceId: string | null): void {
    const pending = this.pending
    this.pending = null
    pending?.(deviceId)
  }
}
