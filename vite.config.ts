import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'

// Copy WASM files to public directory
const wasmPath = resolve(__dirname, 'node_modules/onnxruntime-web/dist')
const publicPath = resolve(__dirname, 'public')

if (!existsSync(publicPath)) {
  mkdirSync(publicPath, { recursive: true })
}

const wasmFiles = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm'
]

wasmFiles.forEach(file => {
  const src = resolve(wasmPath, file)
  const dest = resolve(publicPath, file)
  if (existsSync(src)) {
    copyFileSync(src, dest)
    console.log(`Copied ${file} to public directory`)
  } else {
    console.warn(`Warning: ${file} not found in ${wasmPath}`)
  }
})

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
          'onnxruntime-web': ['onnxruntime-web']
        }
      }
    }
  }
})
