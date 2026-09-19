/** Vial / VIA プロトコルの定数。根拠は docs/PROTOCOL.md。 */

/** raw HID のパケット長。ファームは 32 バイト以外を捨てる。 */
export const MSG_LEN = 32

/** Vial の raw HID インターフェースの識別子。 */
export const VIAL_USAGE_PAGE = 0xff60
export const VIAL_USAGE = 0x61

/** 1 リクエストで読めるバッファの最大バイト数。 */
export const BUFFER_FETCH_CHUNK = 28

// VIA コマンド
export const CMD_VIA_GET_PROTOCOL_VERSION = 0x01
export const CMD_VIA_GET_KEYBOARD_VALUE = 0x02
export const CMD_VIA_GET_LAYER_COUNT = 0x11
export const CMD_VIA_KEYMAP_GET_BUFFER = 0x12
export const CMD_VIA_VIAL_PREFIX = 0xfe

// get_keyboard_value のサブ ID
export const VIA_LAYOUT_OPTIONS = 0x02
export const VIA_SWITCH_MATRIX_STATE = 0x03

// Vial サブコマンド
export const CMD_VIAL_GET_KEYBOARD_ID = 0x00
export const CMD_VIAL_GET_SIZE = 0x01
export const CMD_VIAL_GET_DEFINITION = 0x02
export const CMD_VIAL_GET_ENCODER = 0x03
export const CMD_VIAL_GET_UNLOCK_STATUS = 0x05
export const CMD_VIAL_UNLOCK_START = 0x06
export const CMD_VIAL_UNLOCK_POLL = 0x07
export const CMD_VIAL_LOCK = 0x08
export const CMD_VIAL_DYNAMIC_ENTRY_OP = 0x0d

// dynamic entry op のサブコマンド
export const DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES = 0x00
export const DYNAMIC_VIAL_TAP_DANCE_GET = 0x01

/** matrix tester が入ったのは vial protocol 3 から。 */
export const VIAL_PROTOCOL_MATRIX_TESTER = 3
/** Tap Dance / Combo が入ったのは 4 から。 */
export const VIAL_PROTOCOL_DYNAMIC = 4

/** 本アプリが対応するバージョン(HANDOFF の方針どおり v6 のみ)。 */
export const SUPPORTED_VIAL_PROTOCOL = 6
export const SUPPORTED_VIA_PROTOCOL = 9

/** アンロックのカウンタ上限(vial.c の VIAL_UNLOCK_COUNTER_MAX)。 */
export const VIAL_UNLOCK_COUNTER_MAX = 50
