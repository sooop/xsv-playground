import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [svelte(), viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: {
      // pandoc-wasm의 `exports` 필드는 하위 경로 import를 막고, 브라우저 진입점(index.browser.js)은
      // pandoc.wasm(58MB)을 직접 import한다. wasm 로딩을 직접 관리하기 위해 환경 무관 로직만
      // 담은 core.js를 alias로 우회해서 가져온다 — 번들에는 이 파일과 wasi shim만 들어간다.
      'pandoc-wasm-core': fileURLToPath(new URL('./node_modules/pandoc-wasm/src/core.js', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  // file:// 에서 열리므로 상대 경로여야 한다
  base: './',
})
