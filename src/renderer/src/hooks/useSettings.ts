/**
 * 設定(settings.json)をReactに渡す。
 *
 * 読むのは起動時の1回、変えるのはupdate(patch)の1つだけ。
 *
 * 変えた値はすぐ画面に出し(スライダーを動かしているあいだ待たせない)、Rust側が保存して返した
 * 設定で置き換える。範囲外の値はRust側が丸めるので、返ってきた方が正しい。スライダーを速く
 * 動かすと返事が追いつかず、古い値に一瞬戻るので、最後に送った変更の返事だけを使う。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../../../shared/settings'

export interface SettingsHandle {
  settings: Settings
  /** 変えてよい項目(RENDERER_SETTINGS_KEYS)を変える。 */
  update: (patch: SettingsPatch) => void
  /** キーボード(UID)のレイヤーに名前を付ける。空で消す。 */
  setLayerName: (uid: string, layer: number, name: string) => void
  /** 一度許可したキーボードを忘れる(次の起動から自動では接続しない)。 */
  forgetDevice: (vendorId: number, productId: number) => void
  /** 保存できるか(`window.api`がある = デスクトップ版)。ブラウザで開いたときは保存しない。 */
  canSave: boolean
}

export function useSettings(): SettingsHandle {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  /** 送った変更の通し番号。最後のものの返事だけを使う。 */
  const sent = useRef(0)

  useEffect(() => {
    void window.api?.getSettings().then((loaded) => {
      // 読み終わる前に変えていたら、そちらの返事の方が新しい
      if (sent.current === 0) setSettings(loaded)
    })
  }, [])

  const update = useCallback((patch: SettingsPatch) => {
    setSettings((current) => ({ ...current, ...patch }))
    const id = ++sent.current
    void window.api?.updateSettings(patch).then((saved) => {
      if (id === sent.current) setSettings(saved)
    })
  }, [])

  const setLayerName = useCallback((uid: string, layer: number, name: string) => {
    void window.api?.setLayerName(uid, layer, name).then((saved) => {
      setSettings((current) => ({
        ...current,
        layerNames: { ...current.layerNames, [uid]: saved }
      }))
    })
  }, [])

  const forgetDevice = useCallback((vendorId: number, productId: number) => {
    void window.api?.forgetDevice(vendorId, productId).then((grantedDevices) => {
      setSettings((current) => ({ ...current, grantedDevices }))
    })
  }, [])

  return { settings, update, setLayerName, forgetDevice, canSave: window.api !== undefined }
}
