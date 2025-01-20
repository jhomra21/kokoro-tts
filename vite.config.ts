import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'tools': ['kokoro-js', 'react', 'react-dom']
        }
      },
      external: [
        /.*\.wasm$/,  // Exclude all .wasm files
        /.*\.jsep\.wasm$/  // Exclude all .jsep.wasm files
      ]
    },
    assetsInlineLimit: 0,  // Never inline assets
    modulePreload: {
      polyfill: false  // Disable module preload
    }
  }
})
