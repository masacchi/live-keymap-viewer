/**
 * 撮影用のwindow.api。本物のpreloadの代わりに、設定をメモリに持つだけのものを渡す。
 * これがあるとレイヤー名の欄など「保存できるときだけ出るもの」も撮れる。
 * ウィンドウのモードはSHOTS_WINDOW_MODEで決める(オーバーレイの画面も撮るため)。
 */
const mode = process.env.SHOTS_WINDOW_MODE === 'overlay' ? 'overlay' : 'normal'
const settings = {
  mode,
  labelMode: 'jis',
  overlayOpacity: 0.82,
  overlayAutoFade: true,
  overlayFadedOpacity: 0.2,
  overlayBlur: false,
  showLayerTriggers: false,
  tappingTerm: 200,
  grantedDevices: [{ vendorId: 0xe118, productId: 1, name: 'Cornix LP' }],
  layerNames: {}
}
const noop = () => undefined

window.api = {
  // 撮った絵を毎回同じにするため、版とビルド時刻は決め打ちにする
  getAppInfo: async () => ({
    version: '0.0.0-shots',
    runtime: 'WebView2 153.0.4234.48',
    buildTime: '2026-01-01T00:00:00.000Z',
    logPath: 'C:\\Users\\shots\\AppData\\Roaming\\live-keymap-viewer\\log.txt'
  }),
  // 撮るときはネットワークに出ない。インストーラーで入れていない扱いにする
  checkForUpdate: async () => ({ kind: 'unsupported' }),
  applyUpdate: async () => undefined,
  getSettings: async () => ({ ...settings }),
  updateSettings: async (patch) => Object.assign(settings, patch) && { ...settings },
  setLayerName: async (uid, layer, name) => {
    const list = [...(settings.layerNames[uid] ?? [])]
    while (list.length <= layer) list.push('')
    list[layer] = name
    settings.layerNames[uid] = list
    return list
  },
  forgetDevice: async (vendorId, productId) => {
    settings.grantedDevices = settings.grantedDevices.filter(
      (d) => d.vendorId !== vendorId || d.productId !== productId
    )
    return settings.grantedDevices
  },
  getMode: async () => mode,
  toggleMode: async () => mode,
  setOverlayBlurActive: noop,
  setIgnoreMouseEvents: noop,
  moveBy: noop,
  resizeBy: noop,
  onChooseDevice: () => noop,
  chooseDevice: noop,
  onReleaseHid: () => noop,
  hidReleased: noop,
  report: noop,
  openLog: noop
}
