/**
 * 実機なしで動かすためのモックデバイス。
 *
 * ファーム(vial-qmkのvia.c / vial.c)と同じバイト並びで応答を組み立てる。
 * 既定で名乗るのはCornix LP ― キーマップとTap Danceはreference/Cornix_設定_LT.vil、
 * 定義JSONはCornix LP V1.12のファームから取り出した実物(XZ圧縮のまま)。
 *
 * **ほかのキーボードも名乗れる**(`MockOptions.keyboard`)。このアプリは固定データを持たず、
 * 配置もキーマップもキーボードから読むので、別の行列・レイヤー数・ノブ無し・
 * カスタムキーコード無しでも動くことを、ここで差し替えて確かめられる
 * (tests/otherKeyboard.test.ts)。
 */

import { keyId } from '../layout/geometry'
import {
  MOCK_COLS,
  MOCK_DEFINITION_XZ_BASE64,
  MOCK_ENCODERS,
  MOCK_KEYMAP,
  MOCK_LAYERS,
  MOCK_ROWS,
  MOCK_TAP_DANCE,
  MOCK_UID,
  MOCK_VIA_PROTOCOL,
  MOCK_VIAL_PROTOCOL
} from '../mock/cornix.generated'
import {
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
  VIA_LAYOUT_OPTIONS,
  VIA_SWITCH_MATRIX_STATE,
  VIAL_UNLOCK_COUNTER_MAX
} from './constants'
import type { SendOptions, Transport } from './transport'
import { pad, TransportError } from './transport'

/** atobはブラウザにもNode 16+にもある。 */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * モックが名乗るキーボード。定義JSON・キーマップ・行列の大きさをまとめて差し替える。
 * バイト並びはファームと同じなので、アプリから見れば実機と区別が付かない。
 */
export interface MockKeyboard {
  /** 画面に出す名前(実機のproductNameに当たる)。 */
  label: string
  viaProtocol: number
  vialProtocol: number
  uid: bigint
  /** 定義JSONをXZで固めたもの(base64)。実機の応答と同じ形。 */
  definitionXzBase64: string
  layers: number
  rows: number
  cols: number
  /** [layer][row][col]を平らにした生キーコード列。 */
  keymap: readonly number[]
  /** 枠ごとの[onTap, onHold, onDoubleTap, onTapHold, tappingTerm]。無ければ空。 */
  tapDance: ReadonlyArray<readonly number[]>
  /** [layer][index] = [反時計回り, 時計回り]。ノブが無ければ空。 */
  encoders: ReadonlyArray<ReadonlyArray<readonly number[]>>
}

/** 既定のモック。reference/ の実物から生成したもの(mock/cornix.generated.ts)。 */
export const CORNIX_MOCK: MockKeyboard = {
  label: 'Cornix LP (モック)',
  viaProtocol: MOCK_VIA_PROTOCOL,
  vialProtocol: MOCK_VIAL_PROTOCOL,
  uid: MOCK_UID,
  definitionXzBase64: MOCK_DEFINITION_XZ_BASE64,
  layers: MOCK_LAYERS,
  rows: MOCK_ROWS,
  cols: MOCK_COLS,
  keymap: MOCK_KEYMAP,
  tapDance: MOCK_TAP_DANCE,
  encoders: MOCK_ENCODERS
}

export interface MockOptions {
  /** 名乗るキーボード。既定はCornix LP。 */
  keyboard?: MockKeyboard
  /** 最初からアンロック済みにするか。 */
  unlocked?: boolean
  /** アンロックに使うキー。既定はCornixの左上2つ。 */
  unlockKeys?: Array<{ row: number; col: number }>
  /** 1往復あたりの遅延(ms)。0なら同期的に返す。 */
  latencyMs?: number
}

/**
 * Transportと同じ口を持つ偽デバイス。押下状態はテスト側から動かす。
 */
export class MockTransport implements Transport {
  readonly label: string

  private readonly keyboard: MockKeyboard
  private isOpen = false
  private unlocked: boolean
  private unlockInProgress = false
  private unlockCounter = VIAL_UNLOCK_COUNTER_MAX
  private readonly unlockKeys: Array<{ row: number; col: number }>
  private readonly latencyMs: number
  private readonly pressed = new Set<string>()
  private readonly definitionBytes: Uint8Array

  /** 送られてきたリクエストの記録。テストで順序を確かめるのに使う。 */
  readonly requests: Uint8Array[] = []

  /** 書き換えられるようにコピーを持つ。 */
  private readonly keymap: number[]

  constructor(options: MockOptions = {}) {
    this.keyboard = options.keyboard ?? CORNIX_MOCK
    this.label = this.keyboard.label
    this.definitionBytes = fromBase64(this.keyboard.definitionXzBase64)
    this.keymap = [...this.keyboard.keymap]
    this.unlocked = options.unlocked ?? false
    this.unlockKeys = options.unlockKeys ?? [
      { row: 0, col: 0 },
      { row: 0, col: 1 }
    ]
    this.latencyMs = options.latencyMs ?? 0
  }

  get opened(): boolean {
    return this.isOpen
  }

  async open(): Promise<void> {
    this.isOpen = true
  }

  async close(): Promise<void> {
    this.isOpen = false
  }

  // --- テストから叩く操作---

  /** 物理キーを押す。 */
  press(row: number, col: number): void {
    this.pressed.add(keyId(row, col))
  }

  /** 物理キーを離す。 */
  release(row: number, col: number): void {
    this.pressed.delete(keyId(row, col))
  }

  releaseAll(): void {
    this.pressed.clear()
  }

  /**
   * 進行中のアンロック手順を外から打ち切る。
   * キーボードの挿し直しや、別アプリからのvial_lockを再現するのに使う。
   */
  abortUnlock(): void {
    this.unlockInProgress = false
    this.unlockCounter = VIAL_UNLOCK_COUNTER_MAX
  }

  /**
   * キーマップを書き換える。Vial側で編集された状況を作るのに使う。
   * 実機のset_keycodeは実装していない(このアプリは読むだけなので)。
   */
  setKeycode(layer: number, row: number, col: number, keycode: number): void {
    const { rows, cols } = this.keyboard
    this.keymap[layer * rows * cols + row * cols + col] = keycode
  }

  isPressed(row: number, col: number): boolean {
    return this.pressed.has(keyId(row, col))
  }

  // --- Transport ---

  async send(request: Uint8Array, options?: SendOptions): Promise<Uint8Array> {
    if (!this.isOpen) throw new TransportError('デバイスが開かれていません')
    const msg = pad(request)
    this.requests.push(msg)
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
    }
    const response = this.handle(msg)
    // 実機と同じ応答を返しているなら、呼び出し側の照合は必ず通るはず。
    // 通らないなら照合の側が間違っているので、テストで落とす。
    if (options?.validate && !options.validate(response)) {
      throw new TransportError(
        `応答の照合に失敗した: request=${[...msg.subarray(0, 4)]} response=${[
          ...response.subarray(0, 4)
        ]}`
      )
    }
    return response
  }

  private handle(msg: Uint8Array): Uint8Array {
    // アンロック進行中は0xFEの一部しか通らない(via.c:215-224)
    if (this.unlockInProgress) {
      const allowed =
        msg[0] === CMD_VIA_VIAL_PREFIX &&
        [
          CMD_VIAL_GET_KEYBOARD_ID,
          CMD_VIAL_GET_SIZE,
          CMD_VIAL_GET_DEFINITION,
          CMD_VIAL_GET_UNLOCK_STATUS,
          CMD_VIAL_UNLOCK_START,
          CMD_VIAL_UNLOCK_POLL
        ].includes(msg[1])
      if (!allowed) return msg // ファームは書き換えずにそのまま返す
    }

    return msg[0] === CMD_VIA_VIAL_PREFIX ? this.handleVial(msg) : this.handleVia(msg)
  }

  private handleVia(msg: Uint8Array): Uint8Array {
    const out = new Uint8Array(msg)
    switch (msg[0]) {
      case CMD_VIA_GET_PROTOCOL_VERSION:
        out[1] = (this.keyboard.viaProtocol >> 8) & 0xff
        out[2] = this.keyboard.viaProtocol & 0xff
        return out

      case CMD_VIA_GET_LAYER_COUNT:
        out[1] = this.keyboard.layers
        return out

      case CMD_VIA_KEYMAP_GET_BUFFER: {
        const offset = (msg[1] << 8) | msg[2]
        const size = msg[3]
        if (size > 28) return out
        for (let i = 0; i < size; i++) {
          const at = offset + i
          const keyIndex = at >> 1
          const keycode = this.keymap[keyIndex] ?? 0
          out[4 + i] = at % 2 === 0 ? (keycode >> 8) & 0xff : keycode & 0xff
        }
        return out
      }

      case CMD_VIA_GET_KEYBOARD_VALUE:
        if (msg[1] === VIA_SWITCH_MATRIX_STATE) {
          if (!this.unlocked) return out // ロック中は返さない(via.c:251-255)
          const { rows, cols } = this.keyboard
          const rowSize = Math.ceil(cols / 8)
          for (let row = 0; row < rows; row++) {
            let value = 0
            for (let col = 0; col < cols; col++) {
              if (this.pressed.has(keyId(row, col))) value |= 1 << col
            }
            for (let byte = 0; byte < rowSize; byte++) {
              // 行内はMSBのバイトが先
              const shift = (rowSize - 1 - byte) * 8
              out[2 + row * rowSize + byte] = (value >> shift) & 0xff
            }
          }
          return out
        }
        if (msg[1] === VIA_LAYOUT_OPTIONS) {
          out.fill(0, 2, 6)
          return out
        }
        return out

      default:
        return out
    }
  }

  private handleVial(msg: Uint8Array): Uint8Array {
    const out = new Uint8Array(MSG_LEN)
    out.set(msg)

    switch (msg[1]) {
      case CMD_VIAL_GET_KEYBOARD_ID: {
        out.fill(0)
        const { vialProtocol } = this.keyboard
        out[0] = vialProtocol & 0xff
        out[1] = (vialProtocol >> 8) & 0xff
        out[2] = (vialProtocol >> 16) & 0xff
        out[3] = (vialProtocol >> 24) & 0xff
        let uid = this.keyboard.uid
        for (let i = 0; i < 8; i++) {
          out[4 + i] = Number(uid & 0xffn)
          uid >>= 8n
        }
        return out
      }

      case CMD_VIAL_GET_SIZE: {
        const size = this.definitionBytes.length
        out[0] = size & 0xff
        out[1] = (size >> 8) & 0xff
        out[2] = (size >> 16) & 0xff
        out[3] = (size >> 24) & 0xff
        return out
      }

      case CMD_VIAL_GET_DEFINITION: {
        // ファームが読むのは2バイトだけ(vial.c:117)
        const page = msg[2] | (msg[3] << 8)
        const start = page * MSG_LEN
        if (start >= this.definitionBytes.length) return out
        const end = Math.min(start + MSG_LEN, this.definitionBytes.length)
        out.fill(0)
        out.set(this.definitionBytes.subarray(start, end))
        return out
      }

      case CMD_VIAL_GET_ENCODER: {
        const layer = msg[2]
        const index = msg[3]
        const entry = this.keyboard.encoders[layer]?.[index] ?? [0, 0]
        out[0] = (entry[0] >> 8) & 0xff
        out[1] = entry[0] & 0xff
        out[2] = (entry[1] >> 8) & 0xff
        out[3] = entry[1] & 0xff
        return out
      }

      case CMD_VIAL_GET_UNLOCK_STATUS: {
        out.fill(0xff)
        out[0] = this.unlocked ? 1 : 0
        out[1] = this.unlockInProgress ? 1 : 0
        this.unlockKeys.forEach((key, i) => {
          out[2 + i * 2] = key.row
          out[2 + i * 2 + 1] = key.col
        })
        return out
      }

      case CMD_VIAL_UNLOCK_START:
        this.unlockInProgress = true
        this.unlockCounter = VIAL_UNLOCK_COUNTER_MAX
        return out

      case CMD_VIAL_UNLOCK_POLL: {
        if (this.unlockInProgress) {
          const holding = this.unlockKeys.every((key) => this.isPressed(key.row, key.col))
          if (holding) {
            this.unlockCounter--
            if (this.unlockCounter <= 0) {
              this.unlockInProgress = false
              this.unlocked = true
              this.unlockCounter = 0
            }
          } else {
            this.unlockCounter = VIAL_UNLOCK_COUNTER_MAX
          }
        }
        out[0] = this.unlocked ? 1 : 0
        out[1] = this.unlockInProgress ? 1 : 0
        out[2] = this.unlockCounter
        return out
      }

      case CMD_VIAL_LOCK:
        this.unlocked = false
        return out

      case CMD_VIAL_DYNAMIC_ENTRY_OP: {
        if (msg[2] === DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES) {
          out.fill(0)
          out[0] = this.keyboard.tapDance.length
          out[1] = 0
          out[2] = 0
          out[3] = 0
          return out
        }
        if (msg[2] === DYNAMIC_VIAL_TAP_DANCE_GET) {
          const entry = this.keyboard.tapDance[msg[3]]
          if (!entry) {
            out[0] = 1 // エラー
            return out
          }
          out[0] = 0
          for (let i = 0; i < 5; i++) {
            out[1 + i * 2] = entry[i] & 0xff
            out[1 + i * 2 + 1] = (entry[i] >> 8) & 0xff
          }
          return out
        }
        return out
      }

      default:
        return out
    }
  }
}
