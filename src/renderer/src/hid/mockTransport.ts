/**
 * 実機なしで動かすためのモックデバイス。
 *
 * ファーム(vial-qmk の via.c / vial.c)と同じバイト並びで応答を組み立てる。
 * キーマップと Tap Dance は reference/Cornix_設定_LT.vil、定義 JSON は
 * Cornix LP V1.12 のファームから取り出した実物(XZ 圧縮のまま)を使う。
 */
import {
  CMD_VIAL_DYNAMIC_ENTRY_OP,
  CMD_VIAL_GET_DEFINITION,
  CMD_VIAL_GET_ENCODER,
  CMD_VIAL_GET_KEYBOARD_ID,
  CMD_VIAL_GET_SIZE,
  CMD_VIAL_GET_UNLOCK_STATUS,
  CMD_VIAL_LOCK,
  CMD_VIAL_UNLOCK_POLL,
  CMD_VIAL_UNLOCK_START,
  CMD_VIA_GET_KEYBOARD_VALUE,
  CMD_VIA_GET_LAYER_COUNT,
  CMD_VIA_GET_PROTOCOL_VERSION,
  CMD_VIA_KEYMAP_GET_BUFFER,
  CMD_VIA_VIAL_PREFIX,
  DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES,
  DYNAMIC_VIAL_TAP_DANCE_GET,
  MSG_LEN,
  VIAL_UNLOCK_COUNTER_MAX,
  VIA_LAYOUT_OPTIONS,
  VIA_SWITCH_MATRIX_STATE
} from './constants'
import {
  MOCK_COLS,
  MOCK_DEFINITION_XZ_BASE64,
  MOCK_ENCODERS,
  MOCK_KEYMAP,
  MOCK_LAYERS,
  MOCK_ROWS,
  MOCK_TAP_DANCE,
  MOCK_UID,
  MOCK_VIAL_PROTOCOL,
  MOCK_VIA_PROTOCOL
} from '../mock/cornix.generated'
import { keyId } from '../layout/geometry'
import type { SendOptions, Transport } from './transport'
import { TransportError, pad } from './transport'

/** atob はブラウザにも Node 16+ にもある。 */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export interface MockOptions {
  /** 最初からアンロック済みにするか。 */
  unlocked?: boolean
  /** アンロックに使うキー。既定は Cornix の左上 2 つ。 */
  unlockKeys?: Array<{ row: number; col: number }>
  /** 1 往復あたりの遅延(ms)。0 なら同期的に返す。 */
  latencyMs?: number
}

/**
 * Transport と同じ口を持つ偽デバイス。押下状態はテスト側から動かす。
 */
export class MockTransport implements Transport {
  readonly label = 'Cornix LP (モック)'

  private isOpen = false
  private unlocked: boolean
  private unlockInProgress = false
  private unlockCounter = VIAL_UNLOCK_COUNTER_MAX
  private readonly unlockKeys: Array<{ row: number; col: number }>
  private readonly latencyMs: number
  private readonly pressed = new Set<string>()
  private readonly definitionBytes = fromBase64(MOCK_DEFINITION_XZ_BASE64)

  /** 送られてきたリクエストの記録。テストで順序を確かめるのに使う。 */
  readonly requests: Uint8Array[] = []

  /** 書き換えられるようにコピーを持つ。 */
  private readonly keymap = [...MOCK_KEYMAP]

  constructor(options: MockOptions = {}) {
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

  // --- テストから叩く操作 ---

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
   * キーマップを書き換える。Vial 側で編集された状況を作るのに使う。
   * 実機の set_keycode は実装していない(このアプリは読むだけなので)。
   */
  setKeycode(layer: number, row: number, col: number, keycode: number): void {
    this.keymap[layer * MOCK_ROWS * MOCK_COLS + row * MOCK_COLS + col] = keycode
  }

  isPressed(row: number, col: number): boolean {
    return this.pressed.has(keyId(row, col))
  }

  // --- Transport ---

  async send(request: Uint8Array, options?: SendOptions): Promise<Uint8Array> {
    if (!this.isOpen) throw new TransportError('デバイスが開かれていない')
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
    // アンロック進行中は 0xFE の一部しか通らない(via.c:215-224)
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
        out[1] = (MOCK_VIA_PROTOCOL >> 8) & 0xff
        out[2] = MOCK_VIA_PROTOCOL & 0xff
        return out

      case CMD_VIA_GET_LAYER_COUNT:
        out[1] = MOCK_LAYERS
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
          const rowSize = Math.ceil(MOCK_COLS / 8)
          for (let row = 0; row < MOCK_ROWS; row++) {
            let value = 0
            for (let col = 0; col < MOCK_COLS; col++) {
              if (this.pressed.has(keyId(row, col))) value |= 1 << col
            }
            for (let byte = 0; byte < rowSize; byte++) {
              // 行内は MSB のバイトが先
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
        out[0] = MOCK_VIAL_PROTOCOL & 0xff
        out[1] = (MOCK_VIAL_PROTOCOL >> 8) & 0xff
        out[2] = (MOCK_VIAL_PROTOCOL >> 16) & 0xff
        out[3] = (MOCK_VIAL_PROTOCOL >> 24) & 0xff
        let uid = MOCK_UID
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
        // ファームが読むのは 2 バイトだけ(vial.c:117)
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
        const entry = MOCK_ENCODERS[layer]?.[index] ?? [0, 0]
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
          out[0] = MOCK_TAP_DANCE.length
          out[1] = 0
          out[2] = 0
          out[3] = 0
          return out
        }
        if (msg[2] === DYNAMIC_VIAL_TAP_DANCE_GET) {
          const entry = MOCK_TAP_DANCE[msg[3]]
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
