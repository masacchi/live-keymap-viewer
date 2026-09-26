/**
 * 画面に出す文言。
 *
 * 部品ごとに散らばっていると、同じことを違う言葉で言ってしまう(「キーマップ再読み込み」と
 * 「読み直す」が混ざる、など)うえ、言い回しを直すときに探し回ることになる。ここに集めて、
 * 部品は`messages.toolbar.settings`のように引く。値の入る文言は関数にする。
 *
 * ここに置くもの:
 *   - 画面の部品の文言(ボタン・見出し・説明・ツールチップ・読み上げ用の名前)
 *   - 接続まわりで、そのまま画面に出す案内(「応答するインターフェースを確認中」など)
 * 置かないもの:
 *   - キーの表示名(keycodes/labels.tsの表。JIS / USで引き分ける表そのものが文言の置き場)
 *   - 通信や定義の形式が壊れていたときの細かいエラー(hid/・layout/)。原因の説明と切り離せないので、
 *     起きた場所に書く
 *
 * 多言語にはしない(日本語だけ)。したくなったら、この形のまま別の言語の表を足せる。
 * どこからでも読めるように、このファイルは何もimportしない。
 *
 * ## 書き方
 *
 * - **文はですます調**(「〜します」「〜できます」「〜してください」)。説明・ツールチップ・
 *   エラーの案内など、文の形をしているものはすべてこちら
 * - **ラベルは体言止めのまま**(ボタン・見出し・状態・チップ・単位)。「接続中…」「濃さ」
 *   「長押し中」のような短いラベルまで丁寧にすると、かえって読みにくい
 * - **「押す」はキーボードのキーにだけ使う。**マウス操作は「クリック」「選ぶ」。
 *   このアプリは画面の中にもキーが並ぶので、混ざると何を押すのか分からなくなる
 * - **日本語と英数字のあいだに半角スペースを入れない**(「Ctrl+Alt+Kでも」「L0の濃さ」)。
 *   キーやレイヤーの名前と言葉をつなぐときは`joinWords`を使う。名前が英語同士なら空白を入れ、
 *   日本語が隣り合うなら詰める(「Space長押し」「L2記号」「L2 Sym」)
 * - 専門用語(matrix stateなど)はそのまま出さない。画面では起きていることの言葉にする
 * - **硬い言い回しを避ける。**「アンロックが要る」→「アンロックが必要です」、
 *   「効いている」→「押されています」のように、ふだん使う言葉で書く
 */

/** 日本語(かな・漢字・全角の記号)か。 */
const JAPANESE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/

/**
 * 2つの語をつなぐ。境目のどちらかが日本語なら詰め、どちらも英数字などなら半角スペースを挟む。
 * キーやレイヤーの名前は英語のことも日本語のこともあるので(「Space」「かな」「記号」「Sym」)、
 * 決め打ちの空白ではつながない。
 */
export function joinWords(first: string, second: string): string {
  if (!first) return second
  if (!second) return first
  const glued = JAPANESE.test(first.slice(-1)) || JAPANESE.test(second.slice(0, 1))
  return glued ? `${first}${second}` : `${first} ${second}`
}

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
    stalledHint: '応答が途切れています。省電力で一瞬詰まることがあり、少し待つと戻ります',
    roundTrip: (ms: number) => `(往復${ms}ms)`
  },

  deviceMenu: {
    reload: 'キーマップを読み直す',
    disconnect: '切断'
  },

  toolbar: {
    toOverlay: 'オーバーレイへ',
    toNormal: '通常ウィンドウへ',
    modeShortcutHint: (shortcut: string) => `${shortcut}でも切り替えられます`,
    symbols: '記号の出し方',
    settings: '設定',
    /** 新しい版があるとき、設定ボタンに付ける印の説明。 */
    updateAvailable: '新しい版があります(設定の「このアプリ」から更新できます)'
  },

  /** レイヤーへの行き方。キーの名前の後ろにjoinWordsで付ける(「Space長押し」)。 */
  trigger: {
    hold: '長押し',
    momentary: '押している間',
    toggle: 'で固定',
    to: 'で移動',
    default: 'で既定に',
    oneshot: 'で1回',
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
    showBlank: (count: number) => `+${count}空き`,
    showBlankTitle: (layers: readonly number[]) =>
      `L${layers.join(' / L')}は中身がありません(透過・無効かL0と同じ)。クリックで一覧に出せます`,
    hideBlank: '隠す',
    hideBlankTitle: '中身の無いレイヤーを隠します',
    nameLabel: (layer: number) => `L${layer}の名前`
  },

  preview: {
    previewing: 'をプレビュー中',
    pinnedHint: '(キーを押すかEscで戻ります)',
    hoverHint: '(ポインタを外すと戻ります)',
    back: '戻る',
    /** 記号の出し方で選んだとき(「@ は L2 + W」の「は」。前後の間は画面が余白で取る)。 */
    symbolIs: 'は'
  },

  keyCap: {
    holding: '長押し中',
    holdingKey: (key: string) => joinWords(key.trim(), '長押し中'),
    none: '(なし)',
    holdTo: (layer: number, name?: string) => `長押しで${joinWords(`L${layer}`, name ?? '')}`,
    shift: (text: string) => `Shift: ${text}`
  },

  keyboardView: {
    label: (layer: number, name?: string) =>
      `レイヤー${layer}${name ? `(${name})` : ''}のキーマップ`
  },

  modifiers: {
    on: (name: string) => `${name}が押されています`,
    onForReader: '(押されています)'
  },

  unlock: {
    /** キーの枠のあいだに置く。間は画面が余白で取る(UnlockPanel)。 */
    and: 'と',
    separator: '・',
    pressTogether: 'を同時に、',
    pressOne: 'を、',
    untilFull: 'バーが埋まるまで押し続けてください',
    pressHighlighted: '図で白い破線が回っているキーを、バーが埋まるまで押し続けてください',
    explain:
      '押しているキーを読み取るには、Vialのアンロックが必要です。対象は、図で白い破線が回っているキーです。' +
      '押しても光りませんが、バーが進んでいれば正しく押せています。途中で離すとやり直しになります。' +
      'アンロックを解除したいときは、使い終わったあとでキーボードを挿し直してください。',
    mockHint:
      '(モックでは、キーをクリックすると押したままになります。もう一度クリックすると離します)'
  },

  loading: {
    connecting: '接続中…',
    reading: (device: string | null) => `${device ?? 'キーボード'}を読み込み中`,
    stages: {
      definition: '配置(定義)',
      keymap: 'キーマップ',
      encoders: 'ノブの割り当て',
      tapDance: 'Tap Dance'
    }
  },

  empty: {
    lead: 'Vialに対応したキーボードを接続すると、キーマップと押しているキーがここに出ます。',
    connect: 'キーボードに接続',
    mock: 'モックで試す'
  },

  error: {
    reconnecting: '自動で接続し直しています…',
    retry: '接続し直す'
  },

  /** 画面そのものが落ちたとき(components/ErrorBoundary.tsx)。 */
  crash: {
    title: '画面でエラーが起きました',
    hint: '詳しい記録は、設定の「このアプリ」から開けるログに残っています。切り替えのショートカット(既定はCtrl+Alt+K)でも通常ウィンドウとオーバーレイを行き来できます',
    reload: '画面を読み込み直す',
    toNormal: '通常ウィンドウへ'
  },

  devicePicker: {
    title: '接続するキーボードを選ぶ',
    unnamed: '(名前なし)',
    bluetooth: 'Bluetooth',
    remembered: '前回のキーボード',
    cancel: 'やめる'
  },

  settings: {
    layerNames: 'レイヤー名',
    unnamed: '名前なし',
    layerNamesHint:
      'キーの色帯とツールバーに出ます。キーボードごとに覚えていて、空にすると消えます',
    connectToName: 'キーボードに接続すると付けられます',
    toolbar: 'ツールバー',
    showLayerTriggers: 'レイヤーの行き方を添える',
    showLayerTriggersHint:
      '「L1 BS長押し」のように番号の横に出します。オフのときも、レイヤーにポインタを乗せると出ます',
    overlay: 'オーバーレイ',
    opacity: '濃さ',
    autoFade: 'ベースレイヤー(L0)のあいだは薄くする',
    autoFadeHint: 'ほかのレイヤーに入るかShiftを押すと濃く戻ります',
    fadedOpacity: 'L0の濃さ',
    fadedOpacityHint:
      'ベースレイヤー(L0)のあいだの濃さです。上の「濃さ」に掛かります。0%で見えなくなります(左上のパネルは残ります)',
    blur: '後ろの画面をぼかす',
    blurHint:
      'すりガラスのようにぼかします(Windows 11)。強さはOSが決めます。薄くしているあいだは外れます',
    blurUnsupported: 'Windows 11でだけ使えます',
    overlayPanelToo: 'オーバーレイの左上のパネルからも変えられます',
    shortcut: 'ショートカット',
    toggleShortcut: '切り替え',
    shortcutRecording: 'キーを押してください…',
    shortcutReset: '既定に戻す',
    shortcutHint:
      '通常ウィンドウとオーバーレイを切り替えます。押して、登録したい組み合わせを押してください(Escでやめる)',
    shortcutInvalid:
      'Ctrl・Alt・Winのどれかと、ほかのキーを一緒に押してください(Shiftと文字だけは、ふだんの入力とぶつかるので使えません)',
    shortcutTaken:
      'この組み合わせは、ほかのアプリが使っているため登録できませんでした。別の組み合わせにしてください',
    keys: 'キーの判定',
    tappingTerm: '長押しまで',
    tappingTermValue: (ms: number) => `${ms}ms`,
    tappingTermHint:
      'この時間押し続けると長押し(LTのレイヤー)と判定します。キーボード側の設定(tapping term / hold timeout)と同じ値にすると、表示がずれません。キーボードから読めたときは、そちらを使います。Tap Danceはキーボードに設定された時間を使います',
    tappingTermFromKeyboard: (ms: number) =>
      `キーボードに設定された${ms}msで判定しています(Vialで変えたら、キーマップを読み直すと反映されます)。この値は、キーボードから読めないときに使います`,
    devices: '許可したキーボード',
    devicesHint:
      '起動したときに自動で接続します。「忘れる」を押すと、次からは「キーボードに接続」で選び直しになります',
    noDevices: 'まだありません。一度接続すれば、次からは自動で接続します',
    deviceId: (vendorId: number, productId: number) =>
      `${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`,
    forget: '忘れる',
    about: 'このアプリ',
    /** 置き直しても版は変わらないので、ビルドした時刻で見分ける。 */
    build: (version: string, at: string) => (at ? `v${version}(${at}のビルド)` : `v${version}`),
    runtime: (runtime: string) => runtime,
    logHint: '起動・警告・接続が切れた理由・画面のエラーが残っています',
    openLog: 'ログを開く',
    update: {
      unsupported: '更新は、インストーラーで入れたときに使えます',
      checking: '更新を確認中…',
      latest: '最新の版です',
      available: (version: string) => `v${version}があります`,
      applying: '更新を入れています。終わると起動し直します',
      failed: '更新を確認できませんでした。ネットワークを確認してください',
      applyFailed: '更新を入れられませんでした。もう一度試してください',
      check: '更新を確認',
      apply: '更新して再起動'
    }
  },

  overlay: {
    move: 'ドラッグでウィンドウを移動',
    resize: 'ドラッグで大きさを変える',
    opacity: '濃さ',
    autoFade: 'L0で薄く',
    autoFadeHint:
      'ベースレイヤーのあいだは図を薄くします。ほかのレイヤーやShiftを押すと濃く戻ります',
    fadedOpacity: 'L0の濃さ',
    fadedOpacityHint:
      'ベースレイヤー(L0)のあいだの濃さです。「濃さ」に掛かります。0%で見えなくなります(このパネルは残ります)',
    blur: '後ろをぼかす',
    blurHint: '後ろの画面をすりガラスのようにぼかします(Windows 11)。薄くしているあいだは外れます',
    exit: '通常ウィンドウに戻す'
  },

  symbols: {
    lead: '選ぶと、その記号を打つキーを図で示します。キーを押すかEscで戻ります',
    unavailable: 'このキーマップでは出せません',
    /** 2番目に手数の少ない打ち方の前に置く。 */
    alternative: 'または',
    /** 打ち方が2つ以上あるときのつなぎ(ツールチップと読み上げ用)。 */
    or: '、または',
    tap: (key: string) => joinWords(key, 'タップ')
  },

  /** 接続まわりで、そのまま画面に出す案内(session/keyboardConnection.ts)。 */
  connection: {
    noWebHid: 'WebHIDが使えません',
    probing: '応答するインターフェースを確認中',
    noResponse: (tried: number) =>
      `キーボードが応答しません(${tried}個のインターフェースを試しました)。` +
      'Vialなど別のアプリが使っているか、USB / Bluetoothの出力先が違う可能性があります',
    noMatrix:
      'このキーボードでは押しているキーを読み取れません(Vialのプロトコルか、行列の大きさの制限)',
    deviceGone: 'キーボードが外れました',
    notVial:
      '選んだ機器はVialに対応していません(VIAだけのキーボードや無線レシーバーなど)。' +
      'Vialのキーボードを選び直してください'
  }
} as const
