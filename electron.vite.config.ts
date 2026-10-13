import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        // voiceWorker: tiến trình nhận dạng giọng nói (utilityProcess), file riêng out/main/voiceWorker.js.
        input: { index: resolve('src/main/index.ts'), voiceWorker: resolve('src/main/voiceWorker.ts') }
      }
    }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        // inspect: lớp Soi của trang trong ô Browser (preload riêng của mỗi tab, thế giới cô lập), out/preload/inspect.js.
        input: { index: resolve('src/preload/index.ts'), inspect: resolve('src/preload/inspect.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()]
  }
})
