/**
 * Vial / VIAプロトコル。Transportの上に乗る薄い層。
 *
 * バイト位置の根拠はすべてdocs/PROTOCOL.mdに書いてある。特に、
 * VIAコマンドの戻り値はdata[1]以降、Vialコマンド(0xFE)の戻り値は
 * data[0]以降という非対称に注意。
 */

import { decodeKeycode } from '../keycodes/decode'
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

/** 定義JSONのうち、このアプリが使う部分。 */
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
  /**
   * 0に向かって減る。始まりはファームで違う(vial-qmkはVIAL_UNLOCK_COUNTER_MAX、
   * RMKはまだ押していないアンロックキーの数。docs/BLUETOOTH.md §2.5)。
   */
  counter: number
}

/** 読み込んだキーボードの全体像。 */
export interface KeyboardSnapshot {
  viaProtocol: number
  vialProtocol: number
  uid: string
  definition: VialDefinition
  /** 圧縮した定義のバイト数。キャッシュを引くときの鍵にする。 */
  definitionSize: number
  layers: number
  rows: number
  cols: number
  /** [layer][row][col]の生キーコード。 */
  keymap: number[][][]
  /** 枠の数だけ並ぶ。読んでいない枠はundefined(tapDanceToRead)。 */
  tapDance: Array<TapDanceEntry | undefined>
  /** [layer][encoder][direction]の生キーコード。 */
  encoders: number[][][]
  layoutOptions: number
  /** matrix stateを読めるか(vial protocolとパケットサイズの条件)。 */
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

/**
 * 読み込みがどこまで進んだか。1往復ごとに知らせる。
 * USBなら一瞬だが、Bluetoothでは1往復 約0.5秒で、読み込み全体が数十秒かかる。
 */
export interface LoadProgress {
  stage: 'definition' | 'keymap' | 'encoders' | 'tapDance'
  done: number
  total: number
}

/** 各段の読み出しが、何往復のうち何往復目まで済んだかを知らせる口。 */
type StepReporter = (done: number, total: number) => void

const LONG: SendOptions = { retries: 20, timeoutMs: 500 }

/**
 * このリクエストへの応答かどうかを見分ける関数を作る。
 *
 * VIAコマンドはファームが`data[0]`にコマンドIDをそのまま残す(`via.c`は
 * `command_data = &data[1]`以降にしか書かない)ので、それで照合できる。
 * Vialコマンド(0xFE)は`msg[0]`から上書きしてしまうため照合できない。
 * 幸い0xFE系は読み込み時にしか使わず、ポーリングの本流には出てこない。
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

/** 定義ブロック(XZで圧縮したJSON)のバイト数。 */
export async function getDefinitionSize(transport: Transport): Promise<number> {
  const data = await send(transport, [CMD_VIA_VIAL_PREFIX, CMD_VIAL_GET_SIZE], LONG)
  const size = u32le(data, 0)
  if (size === 0 || size > 1 << 20) {
    throw new ProtocolError(`定義のサイズが異常です(${size}バイト)`)
  }
  return size
}

/** 定義ブロックを全部集めて展開し、JSONにする。sizeを渡さなければ先に問い合わせる。 */
export async function getDefinition(
  transport: Transport,
  size?: number,
  onStep?: StepReporter
): Promise<VialDefinition> {
  let remaining = size ?? (await getDefinitionSize(transport))
  const blocks = Math.ceil(remaining / MSG_LEN)

  const chunks: Uint8Array[] = []
  let total = 0
  for (let block = 0; remaining > 0; block++) {
    // ファームは下位2バイトしか読まないが、vial-guiに合わせてu32 LEで送る
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
    onStep?.(block + 1, blocks)
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

/** キーマップ全体を読み、[layer][row][col]に組み直す。 */
export async function getKeymap(
  transport: Transport,
  layers: number,
  rows: number,
  cols: number,
  onStep?: StepReporter
): Promise<number[][][]> {
  const size = layers * rows * cols * 2
  const buffer = new Uint8Array(size)
  const chunks = Math.ceil(size / BUFFER_FETCH_CHUNK)

  for (let offset = 0; offset < size; offset += BUFFER_FETCH_CHUNK) {
    const chunk = Math.min(size - offset, BUFFER_FETCH_CHUNK)
    const data = await send(
      transport,
      [CMD_VIA_KEYMAP_GET_BUFFER, (offset >> 8) & 0xff, offset & 0xff, chunk],
      LONG
    )
    buffer.set(data.subarray(4, 4 + chunk), offset)
    onStep?.(offset / BUFFER_FETCH_CHUNK + 1, chunks)
  }

  const keymap: number[][][] = []
  for (let layer = 0; layer < layers; layer++) {
    const layerRows: number[][] = []
    for (let row = 0; row < rows; row++) {
      const rowKeys: number[] = []
      for (let col = 0; col < cols; col++) {
        const at = (layer * rows * cols + row * cols + col) * 2
        rowKeys.push(u16be(buffer, at)) // キーコードはbig-endian
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
  count: number,
  onStep?: StepReporter
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
      onStep?.(layer * count + index + 1, layers * count)
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
  if (data[0] !== 0) throw new ProtocolError(`Tap Dance ${index}を読めなかった`)
  return {
    onTap: u16le(data, 1),
    onHold: u16le(data, 3),
    onDoubleTap: u16le(data, 5),
    onTapHold: u16le(data, 7),
    tappingTerm: u16le(data, 9)
  }
}

/**
 * キーマップに無くても読んでおくTap Danceの枠の数(先頭から)。
 * 表示に要るのは使っている枠だけだが、絞りすぎないよう少し余裕を持たせている。
 */
export const TAP_DANCE_ALWAYS_READ = 5

/**
 * 読むTap Danceの番号(昇順)。キーマップとノブで使っている枠と、先頭のTAP_DANCE_ALWAYS_READ個。
 *
 * VialはTap Danceの枠を32個ほど持つが、実際に使うのは数個。1枠1往復なので、
 * 全部読むと読み込みの1/4を占める(Bluetoothでは1往復 約0.5秒)。
 */
export function tapDanceToRead(
  count: number,
  keymap: number[][][],
  encoders: number[][][]
): number[] {
  const indices = new Set<number>()
  for (let i = 0; i < Math.min(count, TAP_DANCE_ALWAYS_READ); i++) indices.add(i)
  for (const raw of [...keymap.flat(2), ...encoders.flat(2)]) {
    const keycode = decodeKeycode(raw)
    if (keycode.kind === 'tapDance' && keycode.index < count) indices.add(keycode.index)
  }
  return [...indices].sort((a, b) => a - b)
}

/** 要る枠だけ読み、枠の数ぶんの配列にして返す(読まない枠はundefined)。 */
async function readTapDance(
  transport: Transport,
  count: number,
  keymap: number[][][],
  encoders: number[][][],
  onStep?: StepReporter
): Promise<Array<TapDanceEntry | undefined>> {
  const entries = new Array<TapDanceEntry | undefined>(count).fill(undefined)
  const indices = tapDanceToRead(count, keymap, encoders)
  for (const [i, index] of indices.entries()) {
    entries[index] = await getTapDance(transport, index)
    onStep?.(i + 1, indices.length)
  }
  return entries
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
 * `unlock_poll`の結果から次の動きを決める。
 *
 * `in_progress`が落ちているのに未アンロック、という状態が起き得る
 * (`vial_lock`が呼ばれた、キーボードが挿し直された、など)。そのときは
 * `unlock_start`からやり直す。放っておくといつまでも進まないため。
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
 * matrix stateのレスポンスを(row, col) → 押下 に展開する。
 *
 * 行ごとにceil(cols/8)バイト。行内はMSBのバイトが先頭に来るので、
 * colが入っているバイトは末尾から数える(docs/PROTOCOL.md §2)。
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

/** vial-guiのMatrixTest.valid()と同じ条件。 */
export function isMatrixTestSupported(vialProtocol: number, rows: number, cols: number): boolean {
  return (
    vialProtocol >= VIAL_PROTOCOL_MATRIX_TESTER &&
    (Math.floor(cols / 8) + 1) * rows <= BUFFER_FETCH_CHUNK
  )
}

/**
 * 読み込んだ定義の置き場所。キーボードのUIDと、圧縮した定義のバイト数で引く。
 *
 * 定義はファームを焼き直さない限り変わらないので、接続するたびに読まなくてよい。読まずに済めば、
 * 応答を照合できない0xFE系の要求(Bluetoothでは取り違えると定義の展開が壊れる)も減る。
 * 焼き直して中身が変わってもバイト数が同じ、ということはあり得るので、手動の再読み込みでは
 * キャッシュを使わずに読み直す(LoadOptions.refreshDefinition)。
 */
export interface DefinitionCache {
  get(uid: string, size: number): VialDefinition | null
  set(uid: string, size: number, definition: VialDefinition): void
}

/**
 * キーマップ側のキャッシュ。キーボードのUIDで引く。
 *
 * 定義(物理配置)はDefinitionCacheが持つ。こちらは**Vialで編集され得るところ**
 * (キーマップ・Tap Dance・エンコーダー・レイアウトオプション)を覚えておき、
 * 接続した直後に**まずキャッシュで画面を出す**ために使う。裏で読み直して、違っていれば差し替える。
 *
 * これが無いと、モードを切り替えるたび・再接続するたびに70往復ほど待つことになる
 * (USBで数秒、Bluetoothでは30秒)。そのあいだ画面には何も出ない。
 */
export interface CachedKeymap {
  /** 圧縮した定義のバイト数。ファームを焼き直したら変わるので、違えば捨てる。 */
  definitionSize: number
  layers: number
  rows: number
  cols: number
  keymap: number[][][]
  tapDance: Array<TapDanceEntry | undefined>
  encoders: number[][][]
  layoutOptions: number
}

export interface KeymapCache {
  get(uid: string): CachedKeymap | null
  set(uid: string, value: CachedKeymap): void
}

/** スナップショットから、キャッシュに残すところだけを取り出す。 */
export function toCachedKeymap(snapshot: KeyboardSnapshot): CachedKeymap {
  return {
    definitionSize: snapshot.definitionSize,
    layers: snapshot.layers,
    rows: snapshot.rows,
    cols: snapshot.cols,
    keymap: snapshot.keymap,
    tapDance: snapshot.tapDance,
    encoders: snapshot.encoders,
    layoutOptions: snapshot.layoutOptions
  }
}

export interface CacheSet {
  definitionCache?: DefinitionCache
  keymapCache?: KeymapCache
}

/**
 * キャッシュだけでスナップショットを組み立てる。使えなければnull(呼んだ側が普通に読む)。
 *
 * 読むのは身元だけ(VIAの版・Vialの版とUID・定義のバイト数の**3往復**)。
 * 定義とキーマップの両方がキャッシュにあり、バイト数も行列の大きさも合っているときだけ返す。
 * 中身が古い可能性は残るので、呼んだ側が裏で読み直して確認する(session/keyboardSession.ts)。
 */
export async function loadCachedKeyboard(
  transport: Transport,
  { definitionCache, keymapCache }: CacheSet
): Promise<KeyboardSnapshot | null> {
  if (!definitionCache || !keymapCache) return null

  const viaProtocol = await getViaProtocol(transport)
  const { vialProtocol, uid } = await getKeyboardId(transport)
  // 未対応のプロトコルは、普通に読ませてそちらでエラーにする(文言が1か所で済む)
  if (viaProtocol !== SUPPORTED_VIA_PROTOCOL || vialProtocol !== SUPPORTED_VIAL_PROTOCOL)
    return null

  const cached = keymapCache.get(uid)
  if (!cached) return null

  const definitionSize = await getDefinitionSize(transport)
  if (cached.definitionSize !== definitionSize) return null
  const definition = definitionCache.get(uid, definitionSize)
  if (!definition) return null
  // 定義とキーマップが食い違っていたら(別々に古くなった)使わない
  if (definition.matrix.rows !== cached.rows || definition.matrix.cols !== cached.cols) return null

  return {
    viaProtocol,
    vialProtocol,
    uid,
    definition,
    definitionSize,
    layers: cached.layers,
    rows: cached.rows,
    cols: cached.cols,
    keymap: cached.keymap,
    tapDance: cached.tapDance,
    encoders: cached.encoders,
    layoutOptions: cached.layoutOptions,
    matrixTestSupported: isMatrixTestSupported(vialProtocol, cached.rows, cached.cols)
  }
}

export interface LoadOptions {
  /** 定義のキャッシュ。無ければ毎回読む。 */
  definitionCache?: DefinitionCache
  /** trueならキャッシュがあっても読み、読んだものでキャッシュを置き換える。 */
  refreshDefinition?: boolean
  /** 1往復ごとに進み具合を知らせる。 */
  onProgress?: (progress: LoadProgress) => void
}

/** onProgressを段ごとのStepReporterにする。 */
function reporter(options: LoadOptions, stage: LoadProgress['stage']): StepReporter | undefined {
  const { onProgress } = options
  return onProgress && ((done, total) => onProgress({ stage, done, total }))
}

async function loadDefinition(
  transport: Transport,
  uid: string,
  options: LoadOptions
): Promise<{ definition: VialDefinition; size: number }> {
  const { definitionCache, refreshDefinition = false } = options
  const onStep = reporter(options, 'definition')
  // サイズは常に先に聞く。キャッシュの鍵であり、スナップショットにも残すため
  const size = await getDefinitionSize(transport)
  const cached = refreshDefinition ? null : definitionCache?.get(uid, size)
  if (cached) return { definition: cached, size }
  const definition = await getDefinition(transport, size, onStep)
  definitionCache?.set(uid, size, definition)
  return { definition, size }
}

/** キーマップ・定義・Tap Danceを一通り読み込む。 */
export async function loadKeyboard(
  transport: Transport,
  options: LoadOptions = {}
): Promise<KeyboardSnapshot> {
  const viaProtocol = await getViaProtocol(transport)
  const { vialProtocol, uid } = await getKeyboardId(transport)

  if (viaProtocol !== SUPPORTED_VIA_PROTOCOL || vialProtocol !== SUPPORTED_VIAL_PROTOCOL) {
    throw new ProtocolError(
      `未対応のプロトコル(VIA ${viaProtocol} / Vial ${vialProtocol})。` +
        `このアプリはVIA ${SUPPORTED_VIA_PROTOCOL} / Vial ${SUPPORTED_VIAL_PROTOCOL}だけに対応しています`
    )
  }

  const { definition, size: definitionSize } = await loadDefinition(transport, uid, options)
  const rows = definition.matrix.rows
  const cols = definition.matrix.cols
  const layers = await getLayerCount(transport)

  const dynamic =
    vialProtocol >= VIAL_PROTOCOL_DYNAMIC
      ? await getDynamicEntryCount(transport)
      : { tapDance: 0, combo: 0, keyOverride: 0, altRepeatKey: 0 }

  const keymap = await getKeymap(transport, layers, rows, cols, reporter(options, 'keymap'))

  // ノブにもTDを割り当てられるので、どのTap Danceを読むかはノブまで読んでから決める
  const encoderCount = countEncoders(definition)
  const encoders =
    encoderCount > 0
      ? await getEncoders(transport, layers, encoderCount, reporter(options, 'encoders'))
      : []

  const tapDance = await readTapDance(
    transport,
    dynamic.tapDance,
    keymap,
    encoders,
    reporter(options, 'tapDance')
  )

  const layoutOptions = definition.layouts.labels ? await getLayoutOptions(transport) : 0

  return {
    viaProtocol,
    vialProtocol,
    uid,
    definition,
    definitionSize,
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
 * 物理配置・customKeycodesが入っている定義JSONは、ファームを焼き直さないと
 * 変わらない(焼き直せばUSBごと再接続になる)。そこで定義は使い回し、Vialで編集され得るところ
 * (キーマップ、Tap Dance、エンコーダー、レイアウトオプション)だけを読み直す。
 * 図を組み直さないので描画も跳ねない。
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

  const encoderCount = countEncoders(previous.definition)
  const encoders = encoderCount > 0 ? await getEncoders(transport, layers, encoderCount) : []

  const tapDance = await readTapDance(transport, dynamic.tapDance, keymap, encoders)

  const layoutOptions = previous.definition.layouts.labels ? await getLayoutOptions(transport) : 0

  return { ...previous, layers, keymap, tapDance, encoders, layoutOptions }
}

/**
 * 読み直した結果が前と同じか(Vialで編集され得るところだけを比べる)。
 * 読み直しても(接続直後の確認・手動の読み直し)、たいていは何も変わっていない。
 */
export function keymapUnchanged(before: KeyboardSnapshot, after: KeyboardSnapshot): boolean {
  const editable = (s: KeyboardSnapshot) =>
    JSON.stringify([s.layers, s.keymap, s.tapDance, s.encoders, s.layoutOptions])
  return editable(before) === editable(after)
}

/** 定義のKLEから、エンコーダーが何個あるかを数える。 */
export function countEncoders(definition: VialDefinition): number {
  const { encoders } = buildGeometry(definition.layouts.keymap)
  return encoders.reduce((max, encoder) => Math.max(max, encoder.index + 1), 0)
}
