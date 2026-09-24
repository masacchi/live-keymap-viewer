/**
 * 画面のビルド設定。`vite`(npm run dev)/ `vite build` はこれを読む。
 *
 * Tauri は build.devUrl(開発)か frontendDist(配布)からこれを読み込む(src-tauri/tauri.conf.json)。
 * `npm run dev` だけならブラウザで開ける(モックと、Chrome / Edge なら WebHID で実機にも)。
 */

import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: { '@': resolve('src/renderer/src') }
  },
  build: {
    outDir: resolve('out/renderer'),
    // outDir が root の外にあるので、明示しないと前回の出力が残る
    emptyOutDir: true
  },
  server: {
    // Tauri の devUrl と合わせる。空いていなければ別の番号にずらさず止める
    port: 5173,
    strictPort: true
  },
  define: {
    // どのビルドが動いているかを設定パネルに出す(platform/tauri.ts)。dev では空
    __BUILD_TIME__: JSON.stringify(command === 'build' ? new Date().toISOString() : '')
  },
  plugins: [react(), tailwindcss()]
}))
