import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Proxy para la consulta SUNAT (DNI/RUC). El navegador bloquea por CORS la
      // llamada directa a api.apis.net.pe; el dev server de Vite reenvía por
      // servidor (sin CORS). La ruta relativa evita el CORS en el front.
      '/api-sunat': {
        target: 'https://api.apis.net.pe',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api-sunat/, ''),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase/')) return 'firebase'
        },
      },
    },
  },
})
