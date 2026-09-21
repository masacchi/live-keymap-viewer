/**
 * main プロセスのビルド設定。
 *
 * Node で動くので SSR ビルド(node: の組み込みは外に出したまま)にする。配布物には
 * node_modules を入れない(scripts/package-win.mjs)ので、electron 以外の依存は束ねる。
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: resolve('src/main/index.ts'),
    outDir: resolve('out/main'),
    rolldownOptions: {
      output: { entryFileNames: 'index.js' }
    }
  },
  ssr: {
    noExternal: true,
    // Electron が実行時に渡すモジュールなので束ねない
    external: ['electron']
  }
})
