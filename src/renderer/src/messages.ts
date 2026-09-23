/**
 * 画面に出す文言。
 *
 * 部品ごとに散らばっていると、同じことを違う言葉で言ってしまう(以前は「キーマップ再読み込み」と
 * 「読み直す」が混ざっていた)し、言い回しを直すときに探し回ることになる。ここに集めて、
 * 部品は `messages.toolbar.settings` のように引く。値の入る文言は関数にする。
 *
 * ここに置くもの:
 *   - 画面の部品の文言(ボタン・見出し・説明・ツールチップ・読み上げ用の名前)
 *   - 接続まわりで、そのまま画面に出す案内(「応答するインターフェースを確認中」など)
 * 置かないもの:
 *   - キーの表示名(keycodes/labels.ts の表。JIS / US で引き分ける表そのものが文言の置き場)
 *   - 通信や定義の形式が壊れていたときの細かいエラー(hid/・layout/)。原因の説明と切り離せないので、
 *     起きた場所に書く
 *
 * 多言語にはしない(日本語だけ)。したくなったら、この形のまま別の言語の表を足せる。
 * どこからでも読めるように、このファイルは何も import しない。
 *
 * ## 書き方
 *
 * - **文はですます調**(「〜します」「〜できます」「〜してください」)。説明・ツールチップ・
 *   エラーの案内など、文の形をしているものはすべてこちら
 * - **ラベルは体言止めのまま**(ボタン・見出し・状態・チップ・単位)。「接続中…」「濃さ」
 *   「長押し中」のような短い札まで丁寧にすると、かえって読みにくい
 * - **「押す」はキーボードのキーにだけ使う。**マウス操作は「クリック」「選ぶ」。
 *   このアプリは画面の中にもキーが並ぶので、混ざると何を押すのか分からなくなる
 * - 専門用語(matrix state など)はそのまま出さない。画面では起きていることの言葉にする
 * - **硬い言い回しを避ける。**「アンロックが要る」→「アンロックが必要です」、
 *   「効いている」→「押されています」のように、ふだん使う言葉で書く
 */

export const messages = {
  status: {
    idle: '未接続',
    connecting: '接続中…',
    loading: 'キーマップを読み込み中…',
    unlocking: 'アンロック中…',
    ready: '接続済み',
    error: 'エラー',
    reloading: '読み直し中…',
    stalled: '応答待ち…',
    stalledHint: '応答が途切れています。省電力で一瞬詰まることがあり、少し待つと戻ります'
  },

  deviceMenu: {
    reload: 'キーマップを読み直す',
    disconnect: '切断'
  },

  toolbar: {
    toOverlay: 'オーバーレイへ',
    toNormal: '通常ウィンドウへ',
    modeShortcut: 'Ctrl+Alt+K',
    modeShortcutHint: 'Ctrl+Alt+K でも切り替えられます',
    symbols: '記号の出し方',
    settings: '設定'
  },

  /** レイヤーへの行き方。キーの名前の後ろに付ける(「Space 長押し」)。 */
  trigger: {
    hold: '長押し',
    momentary: '押している間',
    toggle: 'で固定',
    to: 'で移動',
    default: 'で既定に',
    oneshot: 'で 1 回',
    tapToggle: '押している間',
    /** ベースレイヤー以外に置いたキーなら、先にそのレイヤーを書く。 */
    fromLayer: (layer: number) => `L${layer} → `
  },

  layerStrip: {
    chipTitle: (layer: number, how: string | null) => (how ? `L${layer}: ${how}` : `L${layer}`),
    pinnedHint: 'クリックすると実際の表示に戻ります',
    unpinnedHint: 'ポインタを乗せると表示、クリックで固定します',
    renameHint: 'ダブルクリックで名前を付けられます',
    /** ツールチップの文をつなぐ。 */
    joiner: '。',
    showBlank: (count: number) => `+${count} 空き`,
    showBlankTitle: (layers: readonly number[]) =>
      `L${layers.join(' / L')} は中身がありません(透過・無効か L0 と同じ)。クリックで一覧に出せます`,
    hideBlank: '隠す',
    hideBlankTitle: '中身の無いレイヤーを隠します',
    nameLabel: (layer: number) => `L${layer} の名前`
  },

  preview: {
    previewing: 'をプレビュー中',
    pinnedHint: '(キーを押すか Esc で戻ります)',
    hoverHint: '(ポインタを外すと戻ります)',
    back: '戻る',
    /** 記号の出し方で選んだとき(「@ は L2 + W」の「は」)。 */
    symbolIs: 'は'
  },

  keyCap: {
    holding: '長押し中',
    holdingKey: (key: string) => `${key} 長押し中`.trim(),
    none: '(なし)',
    holdTo: (layer: number, name?: string) => `長押しで L${layer}${name ? ` ${name}` : ''}`,
    shift: (text: string) => `Shift: ${text}`
  },

  keyboardView: {
    label: (layer: number, name?: string) =>
      `レイヤー ${layer}${name ? `(${name})` : ''} のキーマップ`
  },

  modifiers: {
    on: (name: string) => `${name} が押されています`,
    onForReader: '(押されています)'
  },

  unlock: {
    and: ' と ',
    separator: '・',
    pressTogether: 'を同時に、',
    pressOne: 'を、',
    untilFull: 'バーが埋まるまで押し続けてください',
    pressHighlighted: '図で白い破線が回っているキーを、バーが埋まるまで押し続けてください',
    explain:
      '押しているキーを読み取るには、Vial のアンロックが必要です。対象は、図で白い破線が回っているキーです。' +
      '押しても光りませんが、バーが進んでいれば正しく押せています。途中で離すとやり直しになります。' +
      'アンロックを解除したいときは、使い終わったあとでキーボードを挿し直してください。',
    mockHint:
      ' (モックでは、キーをクリックすると押したままになります。もう一度クリックすると離します)'
  },

  loading: {
    connecting: '接続中…',
    reading: (device: string | null) => `${device ?? 'キーボード'} を読み込み中`,
    stages: {
      definition: '配置(定義)',
      keymap: 'キーマップ',
      encoders: 'ノブの割り当て',
      tapDance: 'Tap Dance'
    }
  },

  empty: {
    lead: 'Vial に対応したキーボードを繋ぐと、キーマップと押しているキーがここに出ます。',
    connect: 'キーボードに接続',
    mock: 'モックで試す'
  },

  error: {
    reconnecting: '自動で繋ぎ直しています…',
    retry: '接続し直す'
  },

  /** 画面そのものが落ちたとき(components/ErrorBoundary.tsx)。 */
  crash: {
    title: '画面でエラーが起きました',
    hint: '詳しい記録は、設定の「このアプリ」から開けるログに残っています。Ctrl+Alt+K でも通常ウィンドウとオーバーレイを行き来できます',
    reload: '画面を読み込み直す',
    toNormal: '通常ウィンドウへ'
  },

  devicePicker: {
    title: '接続するキーボードを選ぶ',
    unnamed: '(名前なし)',
    cancel: 'やめる'
  },

  settings: {
    layerNames: 'レイヤー名',
    unnamed: '名前なし',
    layerNamesHint:
      'キーの色帯とツールバーに出ます。キーボードごとに覚えていて、空にすると消えます',
    connectToName: 'キーボードに繋ぐと付けられます',
    toolbar: 'ツールバー',
    showLayerTriggers: 'レイヤーの行き方を添える',
    showLayerTriggersHint:
      '「L1 BS 長押し」のように番号の横に出します。オフのときも、レイヤーにポインタを乗せると出ます',
    knobs: 'ノブの割り当て',
    knobsTop: '図の上',
    knobsBottom: '図の下',
    overlay: 'オーバーレイ',
    opacity: '濃さ',
    autoFade: 'ベースレイヤー(L0)のあいだは薄くする',
    autoFadeHint: 'ほかのレイヤーに入るか Shift を押すと濃く戻ります',
    fadedOpacity: '薄くしたとき',
    fadedOpacityHint: '薄くしたときに残す濃さです。0% で消えます(左上のパネルは残ります)',
    blur: '後ろの画面をぼかす',
    blurHint:
      'すりガラスのようにぼかします(Windows 11)。強さは OS が決めます。薄くしているあいだは外れます',
    blurUnsupported: 'Windows 11 でだけ使えます',
    overlayPanelToo: 'オーバーレイの左上のパネルからも変えられます',
    keys: 'キーの判定',
    tappingTerm: '長押しまで',
    tappingTermValue: (ms: number) => `${ms} ms`,
    tappingTermHint:
      'この時間押し続けると長押し(LT のレイヤー)と判定します。キーボード側の設定(tapping term / hold timeout)と同じ値にすると、表示がずれません。Tap Dance はキーボードに設定された時間を使います',
    devices: '許可したキーボード',
    devicesHint:
      '起動したときに自動で繋ぎます。「忘れる」を押すと、次からは「キーボードに接続」で選び直しになります',
    noDevices: 'まだありません。一度接続すれば、次からは自動で繋がります',
    deviceId: (vendorId: number, productId: number) =>
      `${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`,
    forget: '忘れる',
    about: 'このアプリ',
    /** 置き直しても版は変わらないので、ビルドした時刻で見分ける。 */
    build: (version: string, at: string) => (at ? `v${version}(${at} のビルド)` : `v${version}`),
    electron: (version: string) => `Electron ${version}`,
    logHint: '起動・警告・接続が切れた理由・画面のエラーが残っています',
    openLog: 'ログを開く'
  },

  overlay: {
    move: 'ドラッグでウィンドウを移動',
    resize: 'ドラッグで大きさを変える',
    opacity: '濃さ',
    autoFade: 'L0 で薄く',
    autoFadeHint:
      'ベースレイヤーのあいだは図を薄くします。ほかのレイヤーや Shift を押すと濃く戻ります',
    fadedOpacity: '残す',
    fadedOpacityHint: '薄くしたときに残す濃さです。0% で消えます(このパネルは残ります)',
    blur: '後ろをぼかす',
    blurHint: '後ろの画面をすりガラスのようにぼかします(Windows 11)。薄くしているあいだは外れます',
    exit: '通常ウィンドウに戻す'
  },

  symbols: {
    lead: '選ぶと、その記号を打つキーを図で示します。キーを押すか Esc で戻ります',
    unavailable: 'このキーマップでは出せません',
    /** 2 番目に手数の少ない打ち方の前に置く。 */
    alternative: 'または',
    or: ' / または ',
    tap: (key: string) => `${key} タップ`
  },

  /** 接続まわりで、そのまま画面に出す案内(session/keyboardConnection.ts)。 */
  connection: {
    noWebHid: 'WebHID が使えません',
    probing: '応答するインターフェースを確認中',
    noResponse: (tried: number) =>
      `キーボードが応答しません(${tried} 個のインターフェースを試しました)。` +
      'Vial など別のアプリが使っているか、USB / Bluetooth の出力先が違う可能性があります',
    noMatrix:
      'このキーボードでは押しているキーを読み取れません(Vial のプロトコルか、行列の大きさの制限)',
    deviceGone: 'キーボードが外れました'
  }
} as const
