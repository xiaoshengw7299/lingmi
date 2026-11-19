import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { lingmiSeoPlugin } from './seo/plugin'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
    lingmiSeoPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../nimble-ai/vue-dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 拆出体积大且很少变的依赖：入口包更小、并行下载解析，业务代码更新时这些包仍命中浏览器缓存
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@element-plus/icons-vue')) return 'icons'
          if (id.includes('element-plus')) return 'element-plus'
          if (/node_modules\/(vue|@vue|vue-router|pinia)\//.test(id)) return 'vue-vendor'
          if (id.includes('/ai/') || id.includes('@ai-sdk')) return 'ai-sdk'
          if (id.includes('socket.io') || id.includes('engine.io')) return 'socket'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 统一后端（nimble-ai，端口 3000）
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // AI 视频制作实时推送（Socket.IO）
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
