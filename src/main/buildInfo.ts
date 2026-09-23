/**
 * どのビルドが動いているかを画面とログに出すための情報。
 *
 * WSL で作って Windows に置くので、「直したはずの版が動いているのか」が分からなくなる。
 * バージョンだけでは足りない(版を上げずに何度も置き直す)ので、ビルドした時刻も持つ。
 */

/** ビルドした時刻(vite.main.config.ts の define で埋める)。dev と単体テストでは空。 */
declare const __BUILD_TIME__: string | undefined

export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''
