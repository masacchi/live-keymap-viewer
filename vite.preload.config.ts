/**
 * preload のビルド設定。
 *
 * main と一緒に束ねると、両方が使う src/shared が共有チャンクに切り出されて out/ の形が
 * 変わる。main / preload とも 1 ファイルで完結させたいので別々にビルドする。
 * 拡張子 .mjs は ESM の preload として読ませるため(windows.ts で sandbox: false にしている)。
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: resolve('src/preload/index.ts'),
    outDir: resolve('out/preload'),
    rolldownOptions: {
      output: { entryFileNames: 'index.mjs' }
    }
  },
  ssr: {
    noExternal: true,
    external: ['electron']
  }
})
