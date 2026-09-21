/**
 * renderer(画面)のビルド設定。`vite` / `vite build` はこれを読む。
 *
 * main と preload は Node で動くので別の設定(vite.main.config.ts / vite.preload.config.ts)で
 * 束ねる。3 つを続けて動かすのは package.json の build と scripts/dev.mjs。
 */

import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/renderer'),
  // 本番は loadFile(file://)で開くので、アセットを相対パスで参照させる
  base: './',
  resolve: {
    alias: { '@': resolve('src/renderer/src') }
  },
  build: {
    outDir: resolve('out/renderer'),
    // outDir が root の外にあるので、明示しないと前回の出力が残る
    emptyOutDir: true
  },
  plugins: [react(), tailwindcss()]
})
