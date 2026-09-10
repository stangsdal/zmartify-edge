import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: mode === 'native' ? './' : '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  build: {
    target: 'esnext',
    cssMinify: 'esbuild',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@ionic/') || id.includes('/node_modules/ionicons/')) {
            return 'ionic'
          }
          if (id.includes('/node_modules/recharts/')) {
            return 'charts'
          }
          if (id.includes('/node_modules/framer-motion/')) {
            return 'motion'
          }
          if (id.includes('/node_modules/qrcode/')) {
            return 'qrcode'
          }
        }
      }
    }
  }
}))
