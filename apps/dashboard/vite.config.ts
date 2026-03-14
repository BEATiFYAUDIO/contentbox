import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/buy': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/p': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/c': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/library': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/receipt': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/replay': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/public': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      }
    }
  }
})
