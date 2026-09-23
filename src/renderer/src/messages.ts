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
 * - ボタン・見出し・ラベルは**体言止め**(「キーマップを読み直す」「濃さ」)
 * - 説明とツールチップは**常体の言い切り**(「〜する」「〜できる」「〜になる」)。
 *   「しばらく待つ」「確かめる」のような**メモ調の言い切りは使わない** ― 読み手への指示に
 *   見えてしまう。起きることを説明する形(「少し待つと戻る」「〜の可能性がある」)にする
 * - **「押す」はキーボードのキーにだけ使う。**マウス操作は「クリック」「選ぶ」。
 *   このアプリは画面の中にもキーが並ぶので、混ざると何を押すのか分からなくなる
 * - 専門用語(matrix state など)はそのまま出さない。画面では起きていることの言葉にする
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
    stalledHint: '応答が途切れている。省電力で一瞬詰まることがあり、少し待つと戻る'
  },

  deviceMenu: {
    reload: 'キーマップを読み直す',
    disconnect: '切断'
  },

  toolbar: {
    toOverlay: 'オーバーレイへ',
    toNormal: '通常ウィンドウへ',
    modeShortcut: 'Ctrl+Alt+K',
    modeShortcutHint: 'Ctrl+Alt+K でも切り替えられる',
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
    pinnedHint: 'クリックすると実際の表示に戻る',
    unpinnedHint: 'ポインタを乗せると表示、クリックで固定',
    renameHint: 'ダブルクリックで名前を付ける',
    /** ツールチップの文をつなぐ。 */
    joiner: '。',
    showBlank: (count: number) => `+${count} 空き`,
    showBlankTitle: (layers: readonly number[]) =>
      `L${layers.join(' / L')} は中身が無い(透過・無効か L0 と同じ)。クリックで一覧に出す`,
    hideBlank: '隠す',
    hideBlankTitle: '中身の無いレイヤーを隠す',
    nameLabel: (layer: number) => `L${layer} の名前`
  },

  preview: {
    previewing: 'をプレビュー中',
    pinnedHint: '(キーを押すか Esc で戻る)',
    hoverHint: '(ポインタを外すと戻る)',
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
    on: (name: string) => `${name} が効いている`,
    onForReader: '(効いている)'
  },

  unlock: {
    and: ' と ',
    separator: '・',
    pressTogether: 'を同時に、',
    pressOne: 'を、',
    untilFull: 'バーが埋まるまで押し続ける',
    pressHighlighted: '図で白い破線が回っているキーを、バーが埋まるまで押し続ける',
    explain:
      '押しているキーを読むには、Vial のアンロックが要る。対象は図で白い破線が回っているキー。' +
      '押しても光らないが、バーが進んでいれば効いている。途中で離すとやり直しになる。' +
      'アンロックを解除したいときは、使い終わったあとでキーボードを挿し直す。',
    mockHint: ' (モックでは、キーをクリックすると押したままになる。もう一度クリックで離す)'
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
    lead: 'Vial に対応したキーボードを繋ぐと、キーマップと押しているキーがここに出る。',
    connect: 'キーボードに接続',
    mock: 'モックで試す'
  },

  error: {
    reconnecting: '自動で繋ぎ直している…',
    retry: '接続し直す'
  },

  /** 画面そのものが落ちたとき(components/ErrorBoundary.tsx)。 */
  crash: {
    title: '画面でエラーが起きた',
    hint: '詳しい記録は、設定の「このアプリ」から開けるログに残っている。Ctrl+Alt+K でも通常ウィンドウとオーバーレイを行き来できる',
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
    layerNamesHint: 'キーの色帯とツールバーに出る。キーボードごとに覚えていて、空にすると消える',
    connectToName: 'キーボードに繋ぐと付けられる',
    knobs: 'ノブの割り当て',
    knobsTop: '図の上',
    knobsBottom: '図の下',
    overlay: 'オーバーレイ',
    opacity: '濃さ',
    autoFade: 'ベースレイヤー(L0)のあいだは薄くする',
    autoFadeHint: 'ほかのレイヤーに入るか Shift を押すと濃く戻る',
    fadedOpacity: '薄くしたとき',
    fadedOpacityHint: '薄くしたときに残す濃さ。0% で消える(左上のパネルは残る)',
    blur: '後ろの画面をぼかす',
    blurHint:
      'すりガラスのようにぼかす(Windows 11)。強さは OS が決める。薄くしているあいだは外れる',
    blurUnsupported: 'Windows 11 でだけ使える',
    overlayPanelToo: 'オーバーレイの左上のパネルからも変えられる',
    keys: 'キーの判定',
    tappingTerm: '長押しまで',
    tappingTermValue: (ms: number) => `${ms} ms`,
    tappingTermHint:
      'この時間押し続けると長押し(LT のレイヤー)と見なす。キーボード側の設定(tapping term / hold timeout)と同じ値にすると表示がずれない。Tap Dance はキーボードに設定された時間を使う',
    devices: '許可したキーボード',
    devicesHint:
      '起動したときに自動で繋ぐ。「忘れる」を押すと、次からは「キーボードに接続」で選び直しになる',
    noDevices: 'まだ無い。一度接続すれば、次からは自動で繋がる',
    deviceId: (vendorId: number, productId: number) =>
      `${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`,
    forget: '忘れる',
    about: 'このアプリ',
    /** 置き直しても版は変わらないので、ビルドした時刻で見分ける。 */
    build: (version: string, at: string) => (at ? `v${version}(${at} のビルド)` : `v${version}`),
    electron: (version: string) => `Electron ${version}`,
    logHint: '起動・警告・接続が切れた理由・画面のエラーが残っている',
    openLog: 'ログを開く'
  },

  overlay: {
    move: 'ドラッグでウィンドウを移動',
    resize: 'ドラッグで大きさを変える',
    opacity: '濃さ',
    autoFade: 'L0 で薄く',
    autoFadeHint: 'ベースレイヤーのあいだは図を薄くする。ほかのレイヤーや Shift で濃く戻る',
    fadedOpacity: '残す',
    fadedOpacityHint: '薄くしたときに残す濃さ。0% で消える(このパネルは残る)',
    blur: '後ろをぼかす',
    blurHint: '後ろの画面をすりガラスのようにぼかす(Windows 11)。薄くしているあいだは外れる',
    exit: '通常ウィンドウに戻す'
  },

  symbols: {
    lead: '選ぶと、その記号を打つキーを図で示す。キーを押すか Esc で戻る',
    unavailable: 'このキーマップでは出せない',
    /** 2 番目に手数の少ない打ち方の前に置く。 */
    alternative: 'または',
    or: ' / または ',
    tap: (key: string) => `${key} タップ`
  },

  /** 接続まわりで、そのまま画面に出す案内(session/keyboardConnection.ts)。 */
  connection: {
    noWebHid: 'WebHID が使えない',
    probing: '応答するインターフェースを確認中',
    noResponse: (tried: number) =>
      `キーボードが応答しない(${tried} 個のインターフェースを試した)。` +
      'Vial など別のアプリが使っているか、USB / Bluetooth の出力先が違う可能性がある',
    noMatrix:
      'このキーボードでは押しているキーを読み取れない(Vial のプロトコルか、行列の大きさの制限)',
    deviceGone: 'キーボードが外れた'
  }
} as const
