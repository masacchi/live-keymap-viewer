/**
 * Vial / VIA プロトコル。Transport の上に乗る薄い層。
 *
 * バイト位置の根拠はすべて docs/PROTOCOL.md に書いてある。特に、
 * VIA コマンドの戻り値は data[1] 以降、Vial コマンド(0xFE)の戻り値は
 * data[0] 以降という非対称に注意。
 */

import type { TapDanceEntry } from '../keycodes/tapDance'
import { buildGeometry } from '../layout/geometry'
import {
  BUFFER_FETCH_CHUNK,
  CMD_VIA_GET_KEYBOARD_VALUE,
  CMD_VIA_GET_LAYER_COUNT,
  CMD_VIA_GET_PROTOCOL_VERSION,
  CMD_VIA_KEYMAP_GET_BUFFER,
  CMD_VIA_VIAL_PREFIX,
  CMD_VIAL_DYNAMIC_ENTRY_OP,
  CMD_VIAL_GET_DEFINITION,
  CMD_VIAL_GET_ENCODER,
  CMD_VIAL_GET_KEYBOARD_ID,
  CMD_VIAL_GET_SIZE,
  CMD_VIAL_GET_UNLOCK_STATUS,
  CMD_VIAL_LOCK,
  CMD_VIAL_UNLOCK_POLL,
  CMD_VIAL_UNLOCK_START,
  DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES,
  DYNAMIC_VIAL_TAP_DANCE_GET,
  MSG_LEN,
  SUPPORTED_VIA_PROTOCOL,
  SUPPORTED_VIAL_PROTOCOL,
  VIA_LAYOUT_OPTIONS,
  VIA_SWITCH_MATRIX_STATE,
  VIAL_PROTOCOL_DYNAMIC,
  VIAL_PROTOCOL_MATRIX_TESTER
} from './constants'
import type { SendOptions, Transport } from './transport'
import { decompressDefinition } from './xz'

export class ProtocolError extends Error {}

/** 定義 JSON のうち、このアプリが使う部分。 */
export interface VialDefinition {
  name?: string
  matrix: { rows: number; cols: number }
  layouts: { keymap: unknown[]; labels?: unknown[] }
  customKeycodes?: Array<{ name?: string; title?: string; shortName?: string }>
  [key: string]: unknown
}

export interface UnlockStatus {
  unlocked: boolean
  inProgress: boolean
  /** アンロックのために押し続ける必要がある物理キー。 */
  keys: Array<{ row: number; col: number }>
}

export interface UnlockProgress {
  unlocked: boolean
  inProgress: boolean
  /** 0 に向かって減る。VIAL_UNLOCK_COUNTER_MAX から始まる。 */
  counter: number
}

/** 読み込んだキーボードの全体像。 */
export interface KeyboardSnapshot {
  viaProtocol: number
  vialProtocol: number
  uid: string
  definition: VialDefinition
  layers: number
  rows: number
  cols: number
  /** [layer][row][col] の生キーコード。 */
  keymap: number[][][]
  tapDance: TapDanceEntry[]
  /** [layer][encoder][direction] の生キーコード。 */
  encoders: number[][][]
  layoutOptions: number
  /** matrix state を読めるか(vial protocol とパケットサイズの条件)。 */
  matrixTestSupported: boolean
}

function u16be(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1]
}

function u16le(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8)
}

function u32le(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  )
}

function u32be(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  )
}

const LONG: SendOptions = { retries: 20, timeoutMs: 500 }

/**
 * このリクエストへの応答かどうかを見分ける関数を作る。
 *
 * VIA コマンドはファームが `data[0]` にコマンド ID をそのまま残す(`via.c` は
 * `command_data = &data[1]` 以降にしか書かない)ので、それで照合できる。
 * Vial コマンド(0xFE)は `msg[0]` から上書きしてしまうため照合できない。
 * 幸い 0xFE 系は読み込み時にしか使わず、ポーリングの本流には出てこない。
 */
function validatorFor(request: readonly number[]): ((data: Uint8Array) => boolean) | undefined {
  const id = request[0]
  if (id === CMD_VIA_VIAL_PREFIX) return undefined
  if (id === CMD_VIA_GET_KEYBOARD_VALUE) {
    return (data) => data[0] === id && data[1] === request[1]
  }
  if (id === CMD_VIA_KEYMAP_GET_BUFFER) {
    // オフセットとサイズもそのまま返ってくるので、取り違えを厳密に弾ける
    return (data) =>
      data[0] === id && data[1] === request[1] && data[2] === request[2] && data[3] === request[3]
  }
  return (data) => data[0] === id
}

/** リクエストを組み立てて投げる。応答の照合はここで一括して付ける。 */
function send(
  transport: Transport,
  request: readonly number[],
  options: SendOptions = LONG
): Promise<Uint8Array> {
  return transport.send(new Uint8Array(request), {
    ...options,
    validate: validatorFor(request)
  })
}

export async function getViaProtocol(transport: Transport): Promise<number> {
  const data = await send(transport, [CMD_VIA_GET_PROTOCOL_VERSION], LONG)
  return u16be(data, 1)
}

export async function getKeyboardId(
  transport: Transport
): Promise<{ vialProtocol: number; uid: string }> {
  const data = await send(transport, [CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_KEYBOARD_ID], LONG)
  let uid = 0n
  for (let i = 7; i >= 0; i--) uid = (uid << 8n) | BigInt(data[4 + i])
  return { vialProtocol: u32le(data, 0), uid: uid.toString() }
}

export async function getLayerCount(transport: Transport): Promise<number> {
  const data = await send(transport, [CMD_VIA_GET_LAYER_COUNT], LONG)
  return data[1]
}

/** 定義ブロックを全部集めて展開し、JSON にする。 */
export async function getDefinition(transport: Transport): Promise<VialDefinition> {
  const sizeData = await send(transport, [CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_SIZE], LONG)
  let remaining = u32le(sizeData, 0)
  if (remaining === 0 || remaining > 1 << 20) {
    throw new ProtocolError(`定義サイズが異常: ${remaining}`)
  }

  const chunks: Uint8Array[] = []
  let total = 0
  for (let block = 0; remaining > 0; block++) {
    // ファームは下位 2 バイトしか読まないが、vial-gui に合わせて u32 LE で送る
    const data = await send(transport, [
      CMD_VIA_VIAL_PREFIX,
      CMD_VIAL_GET_DEFINITION,
      block & 0xff,
      (block >> 8) & 0xff,
      (block >> 16) & 0xff,
      (block >> 24) & 0xff
    ])
    const take = Math.min(remaining, MSG_LEN)
    chunks.push(data.subarray(0, take))
    total += take
    remaining -= MSG_LEN
  }

  const payload = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    payload.set(chunk, offset)
    offset += chunk.length
  }

  const json = new TextDecoder().decode(await decompressDefinition(payload))
  return JSON.parse(json) as VialDefinition
}

/** キーマップ全体を読み、[layer][row][col] に組み直す。 */
export async function getKeymap(
  transport: Transport,
  layers: number,
  rows: number,
  cols: number
): Promise<number[][][]> {
  const size = layers * rows * cols * 2
  const buffer = new Uint8Array(size)

  for (let offset = 0; offset < size; offset += BUFFER_FETCH_CHUNK) {
    const chunk = Math.min(size - offset, BUFFER_FETCH_CHUNK)
    const data = await send(
      transport,
      [CMD_VIA_KEYMAP_GET_BUFFER, (offset >> 8) & 0xff, offset & 0xff, chunk],
      LONG
    )
    buffer.set(data.subarray(4, 4 + chunk), offset)
  }

  const keymap: number[][][] = []
  for (let layer = 0; layer < layers; layer++) {
    const layerRows: number[][] = []
    for (let row = 0; row < rows; row++) {
      const rowKeys: number[] = []
      for (let col = 0; col < cols; col++) {
        const at = (layer * rows * cols + row * cols + col) * 2
        rowKeys.push(u16be(buffer, at)) // キーコードは big-endian
      }
      layerRows.push(rowKeys)
    }
    keymap.push(layerRows)
  }
  return keymap
}

export async function getEncoders(
  transport: Transport,
  layers: number,
  count: number
): Promise<number[][][]> {
  const out: number[][][] = []
  for (let layer = 0; layer < layers; layer++) {
    const perLayer: number[][] = []
    for (let index = 0; index < count; index++) {
      const data = await send(
        transport,
        [CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_ENCODER, layer, index],
        LONG
      )
      perLayer.push([u16be(data, 0), u16be(data, 2)])
    }
    out.push(perLayer)
  }
  return out
}

export async function getLayoutOptions(transport: Transport): Promise<number> {
  const data = await send(transport, [CMD_VIA_GET_KEYBOARD_VALUE, VIA_LAYOUT_OPTIONS], LONG)
  return u32be(data, 2)
}

export async function getDynamicEntryCount(
  transport: Transport
): Promise<{ tapDance: number; combo: number; keyOverride: number; altRepeatKey: number }> {
  const data = await send(
    transport,
    [CMD_VIA_VIAL_PREFIX, CMD_VIAL_DYNAMIC_ENTRY_OP, DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES],
    LONG
  )
  return {
    tapDance: data[0],
    combo: data[1],
    keyOverride: data[2],
    altRepeatKey: data[3]
  }
}

export async function getTapDance(transport: Transport, index: number): Promise<TapDanceEntry> {
  const data = await send(
    transport,
    [CMD_VIA_VIAL_PREFIX, CMD_VIAL_DYNAMIC_ENTRY_OP, DYNAMIC_VIAL_TAP_DANCE_GET, index],
    LONG
  )
  if (data[0] !== 0) throw new ProtocolError(`Tap Dance ${index} を読めなかった`)
  return {
    onTap: u16le(data, 1),
    onHold: u16le(data, 3),
    onDoubleTap: u16le(data, 5),
    onTapHold: u16le(data, 7),
    tappingTerm: u16le(data, 9)
  }
}

export async function getUnlockStatus(transport: Transport): Promise<UnlockStatus> {
  const data = await send(transport, [CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_UNLOCK_STATUS], LONG)
  const keys: Array<{ row: number; col: number }> = []
  for (let i = 0; i < 15; i++) {
    const row = data[2 + i * 2]
    const col = data[3 + i * 2]
    if (row !== 0xff && col !== 0xff) keys.push({ row, col })
  }
  return { unlocked: data[0] === 1, inProgress: data[1] === 1, keys }
}

export async function unlockStart(transport: Transport): Promise<void> {
  await send(transport, [CMD_VIA_VIAL_PREFIX, CMD_VIAL_UNLOCK_START], LONG)
}

export async function unlockPoll(transport: Transport): Promise<UnlockProgress> {
  const data = await send(transport, [CMD_VIA_VIAL_PREFIX, CMD_VIAL_UNLOCK_POLL], LONG)
  return { unlocked: data[0] === 1, inProgress: data[1] === 1, counter: data[2] }
}

/** アンロックのポーリング結果を見て、次に何をすべきか。 */
export type UnlockAction = 'done' | 'wait' | 'restart'

/**
 * `unlock_poll` の結果から次の動きを決める。
 *
 * `in_progress` が落ちているのに未アンロック、という状態が起き得る
 * (`vial_lock` が呼ばれた、キーボードが挿し直された、など)。そのときは
 * `unlock_start` からやり直す。放っておくと永遠に進まないので。
 */
export function nextUnlockAction(progress: UnlockProgress): UnlockAction {
  if (progress.unlocked) return 'done'
  if (!progress.inProgress) return 'restart'
  return 'wait'
}

export async function lock(transport: Transport): Promise<void> {
  await send(transport, [CMD_VIA_VIAL_PREFIX, CMD_VIAL_LOCK], LONG)
}

/**
 * matrix state のレスポンスを (row, col) → 押下 に展開する。
 *
 * 行ごとに ceil(cols/8) バイト。行内は MSB のバイトが先頭に来るので、
 * col が入っているバイトは末尾から数える(docs/PROTOCOL.md §2)。
 */
export function decodeMatrixState(data: Uint8Array, rows: number, cols: number): boolean[][] {
  const rowSize = Math.ceil(cols / 8)
  const matrix: boolean[][] = []
  for (let row = 0; row < rows; row++) {
    const start = 2 + row * rowSize
    const rowData = data.subarray(start, start + rowSize)
    const rowState: boolean[] = []
    for (let col = 0; col < cols; col++) {
      const byte = rowData.length - 1 - Math.floor(col / 8)
      rowState.push(((rowData[byte] >> (col % 8)) & 1) === 1)
    }
    matrix.push(rowState)
  }
  return matrix
}

export async function getMatrixState(
  transport: Transport,
  rows: number,
  cols: number
): Promise<boolean[][]> {
  const data = await send(transport, [CMD_VIA_GET_KEYBOARD_VALUE, VIA_SWITCH_MATRIX_STATE], {
    retries: 3,
    timeoutMs: 200
  })
  return decodeMatrixState(data, rows, cols)
}

/** vial-gui の MatrixTest.valid() と同じ条件。 */
export function isMatrixTestSupported(vialProtocol: number, rows: number, cols: number): boolean {
  return (
    vialProtocol >= VIAL_PROTOCOL_MATRIX_TESTER &&
    (Math.floor(cols / 8) + 1) * rows <= BUFFER_FETCH_CHUNK
  )
}

/** キーマップ・定義・Tap Dance を一通り読み込む。 */
export async function loadKeyboard(transport: Transport): Promise<KeyboardSnapshot> {
  const viaProtocol = await getViaProtocol(transport)
  const { vialProtocol, uid } = await getKeyboardId(transport)

  if (viaProtocol !== SUPPORTED_VIA_PROTOCOL || vialProtocol !== SUPPORTED_VIAL_PROTOCOL) {
    throw new ProtocolError(
      `未対応のプロトコル(VIA ${viaProtocol} / Vial ${vialProtocol})。` +
        `このアプリは VIA ${SUPPORTED_VIA_PROTOCOL} / Vial ${SUPPORTED_VIAL_PROTOCOL} だけに対応している`
    )
  }

  const definition = await getDefinition(transport)
  const rows = definition.matrix.rows
  const cols = definition.matrix.cols
  const layers = await getLayerCount(transport)

  const dynamic =
    vialProtocol >= VIAL_PROTOCOL_DYNAMIC
      ? await getDynamicEntryCount(transport)
      : { tapDance: 0, combo: 0, keyOverride: 0, altRepeatKey: 0 }

  const keymap = await getKeymap(transport, layers, rows, cols)

  const tapDance: TapDanceEntry[] = []
  for (let i = 0; i < dynamic.tapDance; i++) {
    tapDance.push(await getTapDance(transport, i))
  }

  const encoderCount = countEncoders(definition)
  const encoders = encoderCount > 0 ? await getEncoders(transport, layers, encoderCount) : []

  const layoutOptions = definition.layouts.labels ? await getLayoutOptions(transport) : 0

  return {
    viaProtocol,
    vialProtocol,
    uid,
    definition,
    layers,
    rows,
    cols,
    keymap,
    tapDance,
    encoders,
    layoutOptions,
    matrixTestSupported: isMatrixTestSupported(vialProtocol, rows, cols)
  }
}

/**
 * キーマップまわりだけ読み直す。
 *
 * 物理配置・customKeycodes が入っている定義 JSON は、ファームを焼き直さないと
 * 変わらない(焼き直せば USB ごと繋ぎ直しになる)。なので定義は使い回して、
 * Vial で編集され得るところ ― キーマップ、Tap Dance、エンコーダー、
 * レイアウトオプション ― だけを取り直す。図が組み直されないので描画も跳ねない。
 */
export async function reloadKeymap(
  transport: Transport,
  previous: KeyboardSnapshot
): Promise<KeyboardSnapshot> {
  const layers = await getLayerCount(transport)
  const dynamic =
    previous.vialProtocol >= VIAL_PROTOCOL_DYNAMIC
      ? await getDynamicEntryCount(transport)
      : { tapDance: 0, combo: 0, keyOverride: 0, altRepeatKey: 0 }

  const keymap = await getKeymap(transport, layers, previous.rows, previous.cols)

  const tapDance: TapDanceEntry[] = []
  for (let i = 0; i < dynamic.tapDance; i++) {
    tapDance.push(await getTapDance(transport, i))
  }

  const encoderCount = countEncoders(previous.definition)
  const encoders = encoderCount > 0 ? await getEncoders(transport, layers, encoderCount) : []

  const layoutOptions = previous.definition.layouts.labels ? await getLayoutOptions(transport) : 0

  return { ...previous, layers, keymap, tapDance, encoders, layoutOptions }
}

/**
 * 読み直した結果が前と同じか(Vial で編集され得るところだけを比べる)。
 * 読み直しはウィンドウにフォーカスが戻るたびに走るが、たいていは何も変わっていない。
 */
export function keymapUnchanged(before: KeyboardSnapshot, after: KeyboardSnapshot): boolean {
  const editable = (s: KeyboardSnapshot) =>
    JSON.stringify([s.layers, s.keymap, s.tapDance, s.encoders, s.layoutOptions])
  return editable(before) === editable(after)
}

/** 定義の KLE から、エンコーダーが何個あるかを数える。 */
export function countEncoders(definition: VialDefinition): number {
  const { encoders } = buildGeometry(definition.layouts.keymap)
  return encoders.reduce((max, encoder) => Math.max(max, encoder.index + 1), 0)
}
