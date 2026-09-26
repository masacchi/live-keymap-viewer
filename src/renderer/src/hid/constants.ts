/** Vial / VIAプロトコルの定数。根拠はdocs/PROTOCOL.md。 */

/** raw HIDのパケット長。ファームは32バイト以外を捨てる。 */
export const MSG_LEN = 32

/** Vialのraw HIDインターフェースの識別子。 */
export const VIAL_USAGE_PAGE = 0xff60
export const VIAL_USAGE = 0x61

/** 1リクエストで読めるバッファの最大バイト数。 */
export const BUFFER_FETCH_CHUNK = 28

// VIAコマンド
export const CMD_VIA_GET_PROTOCOL_VERSION = 0x01
export const CMD_VIA_GET_KEYBOARD_VALUE = 0x02
export const CMD_VIA_GET_LAYER_COUNT = 0x11
export const CMD_VIA_KEYMAP_GET_BUFFER = 0x12
export const CMD_VIA_VIAL_PREFIX = 0xfe

// get_keyboard_valueのサブID
export const VIA_LAYOUT_OPTIONS = 0x02
export const VIA_SWITCH_MATRIX_STATE = 0x03

// Vialサブコマンド
export const CMD_VIAL_GET_KEYBOARD_ID = 0x00
export const CMD_VIAL_GET_SIZE = 0x01
export const CMD_VIAL_GET_DEFINITION = 0x02
export const CMD_VIAL_GET_ENCODER = 0x03
export const CMD_VIAL_GET_UNLOCK_STATUS = 0x05
export const CMD_VIAL_UNLOCK_START = 0x06
export const CMD_VIAL_UNLOCK_POLL = 0x07
export const CMD_VIAL_LOCK = 0x08
/** QMK設定(RMKではbehavior setting)を1つ読む。`[0xFE, 0x0A, qsid_lo, qsid_hi]`。 */
export const CMD_VIAL_QMK_SETTINGS_GET = 0x0a
/** QMK設定の番号(qsid)のうち、長押しの判定時間(tapping term。RMKではMorseTimeout)。u16。 */
export const QSID_TAPPING_TERM = 7
export const CMD_VIAL_DYNAMIC_ENTRY_OP = 0x0d

// dynamic entry opのサブコマンド
export const DYNAMIC_VIAL_GET_NUMBER_OF_ENTRIES = 0x00
export const DYNAMIC_VIAL_TAP_DANCE_GET = 0x01

/** matrix testerが入ったのはvial protocol 3から。 */
export const VIAL_PROTOCOL_MATRIX_TESTER = 3
/** Tap Dance / Comboが入ったのは4から。 */
export const VIAL_PROTOCOL_DYNAMIC = 4

/** このアプリが対応するバージョン(v6のみ)。 */
export const SUPPORTED_VIAL_PROTOCOL = 6
export const SUPPORTED_VIA_PROTOCOL = 9

/** アンロックのカウンタ上限(vial.cのVIAL_UNLOCK_COUNTER_MAX)。 */
export const VIAL_UNLOCK_COUNTER_MAX = 50
