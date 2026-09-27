/**
 * PDFに添付するキーマップ(keymap.json)と、PDFのメタデータを組み立てる。
 *
 * 添付はこのアプリの形式にする。Vialの.vilはマクロ・コンボ・キーオーバーライド・設定まで持つが、
 * このアプリはそれらを読んでいないので、.vilの形で出すと、Vialで読み込んだときにそれらを空で
 * 上書きしてしまうおそれがある。キーコードは名前(Vialと同じ`KC_Q`・`LT2(KC_SPACE)`)と生の値の
 * 両方を持たせ、人が読んでも、ほかの道具で使ってもよいようにする。
 */
import type { PdfExport } from '../../../shared/ipc'
import type { KeyboardSnapshot } from '../hid/vial'
import { decodeKeycode, formatKeycode } from '../keycodes/decode'
import type { LabelMode } from '../keycodes/labels'

export const KEYMAP_FORMAT = 'live-keymap-viewer/keymap'
export const KEYMAP_FORMAT_VERSION = 1

const nameOf = (raw: number): string => formatKeycode(decodeKeycode(raw))

export interface KeymapExportInput {
  snapshot: KeyboardSnapshot
  /**
   * 接続しているデバイスの名前(「Cornix LP」)。題名やファイル名に使う。定義の名前はCornixでは
   * 「HID Keyboard」と汎用のものなので、こちらを優先する。
   */
  deviceLabel: string | null
  /** レイヤー名(番号順、''は名前なし)。 */
  layerNames: readonly string[]
  labelMode: LabelMode
  appVersion: string
  exportedAt: Date
}

/** keymap.jsonの中身。 */
export function buildKeymapExport({
  snapshot,
  deviceLabel,
  layerNames,
  labelMode,
  appVersion,
  exportedAt
}: KeymapExportInput) {
  const definition = snapshot.definition as KeyboardSnapshot['definition'] & {
    vendorId?: string
    productId?: string
  }
  return {
    format: KEYMAP_FORMAT,
    version: KEYMAP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    app: { name: 'Live Keymap Viewer', version: appVersion },
    keyboard: {
      name: keyboardName(snapshot, deviceLabel),
      definitionName: definition.name ?? null,
      vendorId: definition.vendorId ?? null,
      productId: definition.productId ?? null,
      uid: snapshot.uid,
      viaProtocol: snapshot.viaProtocol,
      vialProtocol: snapshot.vialProtocol,
      matrix: { rows: snapshot.rows, cols: snapshot.cols }
    },
    /** 図の文字をどちらの配列の前提で出したか(キーコードそのものは変わらない)。 */
    labelMode,
    /** キーボードから読めた長押しの判定時間(ms)。読めなければnull。 */
    tappingTerm: snapshot.tappingTerm,
    /** キーボードから読めた長押しの判定のしかた。読めなければnull。 */
    holdMode: snapshot.holdMode,
    layoutOptions: snapshot.layoutOptions,
    layers: snapshot.keymap.map((rows, index) => ({
      index,
      name: layerNames[index] ?? '',
      keycodes: rows.map((row) => row.map(nameOf)),
      raw: rows
    })),
    /** [layer][encoder] = [左回り, 右回り]。 */
    encoders: snapshot.encoders.map((layer) => layer.map((directions) => directions.map(nameOf))),
    /** マクロの中身(M(n)を使っていなければ読まないので空)。キーコードは名前にする。 */
    macros: snapshot.macros.map((actions, index) => ({
      index,
      actions: actions.map((action) =>
        action.kind === 'tap' || action.kind === 'down' || action.kind === 'up'
          ? { kind: action.kind, keycodes: action.keycodes.map(nameOf) }
          : action
      )
    })),
    /** 使っているコンボ(押すキーと出るキー)。 */
    combos: snapshot.combos.map((combo) => ({
      index: combo.index,
      keys: combo.keys.map(nameOf),
      output: nameOf(combo.output)
    })),
    /** 読んだ枠だけ(使っている枠と先頭の数個)。 */
    tapDance: snapshot.tapDance.flatMap((entry, index) =>
      entry
        ? [
            {
              index,
              onTap: nameOf(entry.onTap),
              onHold: nameOf(entry.onHold),
              onDoubleTap: nameOf(entry.onDoubleTap),
              onTapHold: nameOf(entry.onTapHold),
              tappingTerm: entry.tappingTerm
            }
          ]
        : []
    )
  }
}

/** 題名やファイル名に使う名前。デバイス名、無ければ定義の名前。 */
function keyboardName(snapshot: KeyboardSnapshot, deviceLabel: string | null): string {
  return deviceLabel?.trim() || snapshot.definition.name?.trim() || 'Keyboard'
}

/** ファイル名に付ける日付(2026-09-27)。 */
function dateStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Rustに渡す書き出しの内容(メタデータと添付)。題名などはPDFのメタデータに入り、
 * エクスプローラーやPDFビューアの「プロパティ」に出る。
 */
export function buildPdfExport(input: KeymapExportInput): PdfExport {
  const { snapshot, deviceLabel, layerNames, labelMode, exportedAt } = input
  const keyboard = keyboardName(snapshot, deviceLabel)
  const named = layerNames.flatMap((name, layer) => (name ? [`L${layer} ${name}`] : []))
  return {
    fileName: `${keyboard}-keymap-${dateStamp(exportedAt)}`,
    title: `${keyboard} キーマップ`,
    subject: `${keyboard}の${snapshot.layers}レイヤーのキーマップ(${labelMode === 'jis' ? 'JIS' : 'US'}表記)`,
    keywords: ['keymap', 'Vial', keyboard, ...named].join(', '),
    custom: [
      ['KeyboardName', keyboard],
      ['KeyboardUID', snapshot.uid],
      ['VialProtocol', String(snapshot.vialProtocol)],
      ['ViaProtocol', String(snapshot.viaProtocol)],
      ['Layers', String(snapshot.layers)],
      ['LabelMode', labelMode],
      ['KeymapFormat', `${KEYMAP_FORMAT}@${KEYMAP_FORMAT_VERSION}`]
    ],
    keymapJson: JSON.stringify(buildKeymapExport(input), null, 2)
  }
}
