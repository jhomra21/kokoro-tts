/// <reference lib="webworker" />

// Configure environment before imports
console.log('Configuring ONNX Runtime...');

// iOS detection
const isIOS = () => {
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(platform) || 
         (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

// R2 bucket URL - replace with your actual R2 bucket URL
const R2_BUCKET_URL = 'https://pub-c65d1a273aab4fc9aea3561a3b0e9a3e.r2.dev';

// Configure ONNX paths before importing
(globalThis as any).ONNX_RUNTIME_CONFIG = {
  numThreads: isIOS() ? 1 : (navigator.hardwareConcurrency || 4),
  wasmPaths: isIOS() ? {
    // Fallback paths for iOS
    'ort-wasm.wasm': `${R2_BUCKET_URL}/ort-wasm.wasm`,
    'ort-wasm.jsep.wasm': `${R2_BUCKET_URL}/ort-wasm.jsep.wasm`
  } : {
    // SIMD paths for other platforms
    'ort-wasm-simd-threaded.wasm': `${R2_BUCKET_URL}/ort-wasm-simd-threaded.wasm`,
    'ort-wasm-simd-threaded.jsep.wasm': `${R2_BUCKET_URL}/ort-wasm-simd-threaded.jsep.wasm`
  }
};

// Import dependencies
import { KokoroTTS } from 'kokoro-js';
// @ts-ignore
import * as ort from 'onnxruntime-web'; 

// Configure ONNX runtime for maximum performance
ort.env.wasm.numThreads = isIOS() ? 1 : (navigator.hardwareConcurrency || 4);
ort.env.wasm.simd = !isIOS(); // Disable SIMD on iOS
ort.env.wasm.proxy = false; // Disable proxy for direct execution

// Enable WebAssembly optimizations
if (crossOriginIsolated && !isIOS()) {
  console.log('Cross-Origin Isolated environment detected, enabling SharedArrayBuffer');
  ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
} else {
  console.log('Cross-Origin Isolation not available or iOS device detected, falling back to single thread');
  ort.env.wasm.numThreads = 1;
}

console.log('ONNX Runtime configured:', {
  numThreads: ort.env.wasm.numThreads,
  simd: ort.env.wasm.simd,
  proxy: ort.env.wasm.proxy,
  isIOS: isIOS(),
  crossOriginIsolated
});

let tts: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, text, voice, speed, volume } = e.data;
  
  try {
    // Log incoming message for debugging
    console.debug('Worker received message:', { type, text: text?.slice(0, 50), voice, speed, volume });

    // Handle initialization message
    if (type === 'init') {
      if (!tts) {
        console.log('Initializing TTS model...');
        console.time('model_load');
        tts = await KokoroTTS.from_pretrained(
          "onnx-community/Kokoro-82M-ONNX",
          { 
            dtype: isIOS() ? "fp32" : "q8", // Use fp32 for iOS for better compatibility
            device: "wasm",
            progress_callback: (info: any) => {
              
              let progress = 0;
              if (typeof info === 'number') {
                progress = info;
              } else if (info.status === 'progress' && typeof info.progress === 'number') {
                progress = info.progress;
              } else if (info.status === 'download' && info.file) {
                // Handle download progress
                progress = 0.5; // Show some progress during download
              }
              
              // Ensure progress is between 0 and 1
              progress = Math.max(0, Math.min(1, progress));
              
              // Send progress update
              postMessage({ 
                type: 'progress', 
                progress
              });
            }
          }
        );
        console.timeEnd('model_load');
        
        console.log('TTS model initialized successfully');
        postMessage({ type: 'model_loaded' });
      }
      return;
    }

    // Handle text generation
    if (!text) return;
    
    // Log generation request
    console.debug('Generating audio with voice:', voice);

    // Generate audio
    console.time('generate');
    let generationProgress = 0;
    const result = await tts.generate(text, { 
      voice, 
      speed, 
      volume,
      progress_callback: (progress: number) => {
        // Ensure progress is between 0 and 1
        generationProgress = Math.max(0, Math.min(1, progress));
        postMessage({ 
          type: 'progress', 
          progress: generationProgress
        });
      }
    });
    console.timeEnd('generate');
    
    // Send raw audio data back to main thread
    console.debug('Generated audio:', { 
      length: result.audio.length,
      samplingRate: result.sampling_rate,
      hasAudio: !!result.audio,
      usedVoice: voice
    });

    self.postMessage({
      type: 'complete',
      data: {
        audio: result.audio,
        sampling_rate: result.sampling_rate,
        usedVoice: voice
      }
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