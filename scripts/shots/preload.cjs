/**
 * 撮影用の window.api。本物の preload の代わりに、設定をメモリに持つだけのものを渡す。
 * これがあるとレイヤー名の欄など「保存できるときだけ出るもの」も撮れる。
 * ウィンドウのモードは SHOTS_WINDOW_MODE で決める(オーバーレイの画面も撮るため)。
 */
const mode = process.env.SHOTS_WINDOW_MODE === 'overlay' ? 'overlay' : 'normal'
const settings = {
  mode,
  labelMode: 'jis',
  overlayOpacity: 0.82,
  overlayAutoFade: true,
  overlayFadedOpacity: 0.2,
  overlayBlur: false,
  encoderPlacement: 'bottom',
  grantedDevices: [],
  layerNames: {}
}
const noop = () => undefined

window.api = {
  getSettings: async () => ({ ...settings }),
  updateSettings: async (patch) => Object.assign(settings, patch) && { ...settings },
  setLayerName: async (uid, layer, name) => {
    const list = [...(settings.layerNames[uid] ?? [])]
    while (list.length <= layer) list.push('')
    list[layer] = name
    settings.layerNames[uid] = list
    return list
  },
  getMode: async () => mode,
  toggleMode: async () => mode,
  setOverlayBlurActive: noop,
  setIgnoreMouseEvents: noop,
  moveBy: noop,
  resizeBy: noop,
  onChooseDevice: () => noop,
  chooseDevice: noop
}
