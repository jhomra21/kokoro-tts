// Configure environment before imports
console.log('Configuring ONNX Runtime...');

(globalThis as any).ONNX_RUNTIME_CONFIG = {
  numThreads: navigator.hardwareConcurrency || 4,
  wasmPaths: {
    'ort-wasm-simd-threaded.wasm': './ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.wasm': './ort-wasm-simd-threaded.jsep.wasm'
  }
};

import { KokoroTTS } from 'kokoro-js';
import * as ort from 'onnxruntime-web';

console.log('Imported dependencies');

// Configure ONNX runtime for maximum performance
ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
ort.env.wasm.simd = true;
ort.env.wasm.proxy = false; // Disable proxy for direct execution

// Enable WebAssembly optimizations
if (crossOriginIsolated) {
  console.log('Cross-Origin Isolated environment detected, enabling SharedArrayBuffer');
  ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
} else {
  console.log('Cross-Origin Isolation not available, falling back to single thread');
  ort.env.wasm.numThreads = 1;
}

console.log('ONNX Runtime configured:', {
  numThreads: ort.env.wasm.numThreads,
  simd: ort.env.wasm.simd,
  proxy: ort.env.wasm.proxy,
  crossOriginIsolated
});

let tts: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, text, voice, speed, volume } = e.data;
  
  try {
    // Handle initialization message
    if (type === 'init') {
      if (!tts) {
        console.log('Initializing TTS model...');
        console.time('model_load');
        tts = await KokoroTTS.from_pretrained(
          "onnx-community/Kokoro-82M-ONNX",
          { 
            dtype: "q8", // Use faster quantization
            device: "wasm",
            progress_callback: (info: any) => {
              console.log('Loading progress:', info);
              if (typeof info === 'number') {
                postMessage({ type: 'progress', progress: info });
              } else if (info.status === 'progress') {
                postMessage({ type: 'progress', progress: info.progress });
              }
            }
          }
        );
        console.timeEnd('model_load');
        
        console.log('TTS model initialized successfully');
        // Notify main thread that model is loaded
        postMessage({ type: 'model_loaded' });
      }
      return;
    }

    // Handle text generation
    if (!text) return;
    
    // Initialize model if not already done
    if (!tts) {
      console.log('Initializing TTS model...');
      console.time('model_load');
      tts = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-ONNX",
        { 
          dtype: "q4", // Use faster quantization
          device: "wasm",
          progress_callback: (info: any) => {
            console.log('Loading progress:', info);
            if (typeof info === 'number') {
              postMessage({ type: 'progress', progress: info });
            } else if (info.status === 'progress') {
              postMessage({ type: 'progress', progress: info.progress });
            }
          }
        }
      );
      console.timeEnd('model_load');
      
      console.log('TTS model initialized successfully');
      // Notify main thread that model is loaded
      postMessage({ type: 'model_loaded' });
    }

    // Generate audio
    console.time('generate');
    const result = await tts.generate(text, { voice, speed, volume });
    console.timeEnd('generate');
    
    // Send raw audio data back to main thread
    postMessage({ 
      type: 'complete',
      audio: result.audio, 
      sampling_rate: result.sampling_rate 
    }, { transfer: [result.audio.buffer] });

  } catch (error: any) {
    console.error('TTS Error:', error);
    postMessage({ 
      type: 'error', 
      error: error?.message || String(error)
    });
  }
};

// TypeScript worker type declaration
export {}; 