/**
 * キーマップから、レイヤーごとの「そこへの行き方」と「中身があるか」を読み取る。
 *
 * レイヤーの一覧に番号だけを並べても、どのキーでそのレイヤーに入るのかが分からない。
 * キーマップを見れば分かるので、ここで拾う。
 *
 * 押下の状態には触らない(読み込んだキーマップだけを見る)。一覧の表示に使う。
 */
import { decodeKeycode, KC_NO, KC_TRNS, type Keycode } from '../keycodes/decode'
import { type LabelContext, type LabelMode, labelForKeycode } from '../keycodes/labels'
import { holdLayerOf, type TapDanceEntry } from '../keycodes/tapDance'
import { messages } from '../messages'

/** そのキーでレイヤーに入る方法。 */
export type TriggerKind =
  /** LT(n, kc)や、on_holdがMO(n)のTap Dance。タップすると別の文字 */
  | 'hold'
  /** MO(n) / LM(n, mod)。押しているあいだ */
  | 'momentary'
  /** TG(n)。押すたびに固定 / 解除 */
  | 'toggle'
  /** TO(n)。そのレイヤーへ移る */
  | 'to'
  /** DF(n) / PDF(n)。既定のレイヤーを変える */
  | 'default'
  /** OSL(n)。次の1打だけ */
  | 'oneshot'
  /** TT(n)。押しているあいだ、連打で固定 */
  | 'tapToggle'

export interface LayerTrigger {
  /** キーが置いてあるレイヤー。多くは0。 */
  fromLayer: number
  row: number
  col: number
  kind: TriggerKind
  keycode: Keycode
}

export interface LayerSummary {
  layer: number
  /** このレイヤーに入るキー。ベースレイヤーにあるものから順に並ぶ。 */
  triggers: LayerTrigger[]
  /**
   * 中身が無い(すべて透過か無効か、ベースレイヤーと同じ)。
   * CornixのL5〜L9は、ノブの押し込みがL0と同じで、ほかはすべてKC_NO。
   */
  blank: boolean
}

export interface LayerSummaryInput {
  /** [layer][row][col]の生キーコード。 */
  keymap: number[][][]
  tapDance: ReadonlyArray<Pick<TapDanceEntry, 'onHold'> | undefined>
  /** [layer][encoder][direction]の生キーコード。ノブにだけ割り当てたレイヤーも空と見なさない。 */
  encoders?: number[][][]
}

/** このキーコードで入るレイヤーと、その入り方。レイヤーに関わらないキーならnull。 */
export function triggerOf(
  keycode: Keycode,
  tapDance: LayerSummaryInput['tapDance']
): { layer: number; kind: TriggerKind } | null {
  switch (keycode.kind) {
    case 'layerMod':
      return { layer: keycode.layer, kind: 'momentary' }
    case 'layer':
      return { layer: keycode.layer, kind: LAYER_OP_KIND[keycode.op] }
    case 'layerTap':
    case 'tapDance': {
      const layer = holdLayerOf(keycode, tapDance)
      return layer === null ? null : { layer, kind: 'hold' }
    }
    default:
      return null
  }
}

const LAYER_OP_KIND: Record<Extract<Keycode, { kind: 'layer' }>['op'], TriggerKind> = {
  MO: 'momentary',
  TG: 'toggle',
  TO: 'to',
  DF: 'default',
  PDF: 'default',
  OSL: 'oneshot',
  TT: 'tapToggle'
}

/** 透過・無効・ベースレイヤーと同じ、のどれか(そのレイヤーで何も決めていない)。 */
function isFiller(raw: number | undefined, base: number | undefined): boolean {
  return raw === undefined || raw === KC_TRNS || raw === KC_NO || raw === base
}

function isBlank(input: LayerSummaryInput, layer: number): boolean {
  if (layer === 0) return false
  const keys = input.keymap[layer] ?? []
  const base = input.keymap[0] ?? []
  const keysBlank = keys.every((row, r) => row.every((raw, c) => isFiller(raw, base[r]?.[c])))
  const encoders = input.encoders?.[layer] ?? []
  const baseEncoders = input.encoders?.[0] ?? []
  const encodersBlank = encoders.every((dirs, e) =>
    dirs.every((raw, d) => isFiller(raw, baseEncoders[e]?.[d]))
  )
  return keysBlank && encodersBlank
}

export function summarizeLayers(input: LayerSummaryInput): LayerSummary[] {
  const summaries: LayerSummary[] = input.keymap.map((_, layer) => ({
    layer,
    triggers: [],
    blank: isBlank(input, layer)
  }))

  // レイヤー → 行 → 列の順に見るので、ベースレイヤーにある行き方が先に並ぶ
  input.keymap.forEach((rows, fromLayer) => {
    rows.forEach((cols, row) => {
      cols.forEach((raw, col) => {
        const keycode = decodeKeycode(raw)
        const trigger = triggerOf(keycode, input.tapDance)
        // 自分自身へのキー(L2に置いたMO(2)など)は行き方にならない
        if (!trigger || trigger.layer === fromLayer) return
        summaries[trigger.layer]?.triggers.push({
          fromLayer,
          row,
          col,
          kind: trigger.kind,
          keycode
        })
      })
    })
  })
  return summaries
}

/**
 * 行き方の短い説明。LT / Tap Danceはタップ側の文字(「Space長押し」)、MOやTGは
 * キーそのものの名前(「TG2で固定」)で言う。ベースレイヤー以外にあるキーなら、先にそのレイヤーを書く。
 */
export function describeTrigger(
  trigger: LayerTrigger,
  mode: LabelMode,
  context: LabelContext
): string {
  const name = labelForKeycode(trigger.keycode, mode, context).main
  const from = trigger.fromLayer === 0 ? '' : messages.trigger.fromLayer(trigger.fromLayer)
  return `${from}${name} ${messages.trigger[trigger.kind]}`
}
