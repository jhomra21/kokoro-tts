import { useState, useEffect, useRef, useCallback } from 'react'
import { AudioPlayer } from './components/AudioPlayer'
import './App.css'

interface Voice {
  id: string;
  name: string;
  language: string;
  gender: string;
}

interface AudioGeneration {
  id: string;
  text: string;
  voice: string;
  voiceId: string;
  timestamp: number;
  audio: Float32Array;
  audioUrl?: string;
  samplingRate: number;
}

interface PlaybackState {
  context: AudioContext | null;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  startTime: number;
  offset: number;
  duration: number;
  buffer: AudioBuffer | null;
  animationFrame: number | null;
}

interface TTSState {
  isLoading: boolean;
  isPlaying: boolean;
  isGenerating: boolean;
  error: string | null;
  loadingMessage: string;
  voices: Voice[];
  speed: number;
  volume: number;
  history: AudioGeneration[];
  currentlyPlaying: string | null;
  playbackProgress: number;
  currentTime: string;
  duration: string;
  generationProgress: number;
}

// Define voices array outside component to avoid recreating it
const AVAILABLE_VOICES: Voice[] = [
  { id: 'af', name: 'Default', language: 'en-us', gender: 'Female' },
  { id: 'af_bella', name: 'Bella', language: 'en-us', gender: 'Female' },
  { id: 'af_nicole', name: 'Nicole', language: 'en-us', gender: 'Female' },
  { id: 'af_sarah', name: 'Sarah', language: 'en-us', gender: 'Female' },
  { id: 'af_sky', name: 'Sky', language: 'en-us', gender: 'Female' },
  { id: 'am_adam', name: 'Adam', language: 'en-us', gender: 'Male' },
  { id: 'am_michael', name: 'Michael', language: 'en-us', gender: 'Male' },
  { id: 'bf_emma', name: 'Emma', language: 'en-gb', gender: 'Female' },
  { id: 'bf_isabella', name: 'Isabella', language: 'en-gb', gender: 'Female' },
  { id: 'bm_george', name: 'George', language: 'en-gb', gender: 'Male' },
  { id: 'bm_lewis', name: 'Lewis', language: 'en-gb', gender: 'Male' }
];

// Add WAV encoding function
const encodeWAV = (audioData: Float32Array, sampleRate: number): Blob => {
  const buffer = new ArrayBuffer(44 + audioData.length * 2);
  const view = new DataView(buffer);

  // Write WAV header
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // File length
  view.setUint32(4, 36 + audioData.length * 2, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // Format chunk identifier
  writeString(view, 12, 'fmt ');
  // Format chunk length
  view.setUint32(16, 16, true);
  // Sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // Channels
  view.setUint16(22, 1, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate
  view.setUint32(28, sampleRate * 2, true);
  // Block align
  view.setUint16(32, 2, true);
  // Bits per sample
  view.setUint16(34, 16, true);
  // Data chunk identifier
  writeString(view, 36, 'data');
  // Data chunk length
  view.setUint32(40, audioData.length * 2, true);

  // Write audio data
  const volume = 0.5;
  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    view.setInt16(44 + i * 2, sample * 0x7FFF * volume, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

// Add download handler
const handleDownload = (audio: Float32Array, samplingRate: number, text: string) => {
  const blob = encodeWAV(audio, samplingRate);
  const url = URL.createObjectURL(blob);
  
  // Create temporary link and click it
  const a = document.createElement('a');
  a.href = url;
  a.download = `${text.slice(0, 30).replace(/[^a-z0-9]/gi, '_')}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Cleanup
  URL.revokeObjectURL(url);
};

function App() {
  const [text, setText] = useState('')
  const [selectedVoice, setSelectedVoice] = useState('af_sky')
  const workerRef = useRef<Worker | null>(null)
  const [playback] = useState<PlaybackState>({
    context: null,
    source: null,
    gainNode: null,
    startTime: 0,
    offset: 0,
    duration: 0,
    buffer: null,
    animationFrame: null
  })
  const [state, setState] = useState<TTSState>({
    isLoading: true,
    isPlaying: false,
    isGenerating: false,
    error: null,
    loadingMessage: 'Initializing TTS engine...',
    voices: AVAILABLE_VOICES,
    speed: 1.0,
    volume: 1.0,
    history: [],
    currentlyPlaying: null,
    playbackProgress: 0,
    currentTime: '0:00',
    duration: '0:00',
    generationProgress: 0
  })
  const [, setSeekPosition] = useState<{id: string, position: number} | null>(null)
  const playAnimationRef = useRef<number | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Load history from IndexedDB on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const db = await openDB()
        const tx = db.transaction('history', 'readonly')
        const store = tx.objectStore('history')
        const request = store.getAll()
        
        request.onsuccess = () => {
          setState(prev => ({ ...prev, history: request.result }))
        }
      } catch (error) {
        console.error('Failed to load history:', error)
      }
    }
    loadHistory()
  }, [])

  // Save history to IndexedDB when it changes
  useEffect(() => {
    const saveHistory = async () => {
      try {
        const db = await openDB()
        const tx = db.transaction('history', 'readwrite')
        const store = tx.objectStore('history')
        
        // Clear existing entries and add new ones
        await new Promise<void>((resolve, reject) => {
          const clearRequest = store.clear()
          clearRequest.onsuccess = () => {
            let completed = 0
            state.history.forEach(item => {
              const request = store.add(item)
              request.onsuccess = () => {
                completed++
                if (completed === state.history.length) {
                  resolve()
                }
              }
              request.onerror = () => reject(request.error)
            })
          }
          clearRequest.onerror = () => reject(clearRequest.error)
        })
      } catch (error) {
        console.error('Failed to save history:', error)
      }
    }
    if (state.history.length > 0) {
      saveHistory()
    }
  }, [state.history])

  // Format time in MM:SS
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  const updateProgress = useCallback(() => {
    if (playback.context && playback.startTime && playback.buffer) {
      const elapsed = playback.context.currentTime - playback.startTime + playback.offset;
      const duration = playback.buffer.duration;
      
      if (elapsed >= duration) {
        // Reset playback when done
        if (playback.source) {
          playback.source.stop();
          playback.source.onended = null;
        }
        if (playAnimationRef.current) {
          cancelAnimationFrame(playAnimationRef.current);
          playAnimationRef.current = null;
        }
        setState(prev => ({ 
          ...prev, 
          isPlaying: false,
          currentlyPlaying: null,
          playbackProgress: 0
        }));
        setSeekPosition(null);
        return;
      }

      const progress = Math.min(elapsed / duration, 1);
      setState(prev => ({
        ...prev,
        playbackProgress: progress
      }));

      playAnimationRef.current = requestAnimationFrame(updateProgress);
    }
  }, [playback.context, playback.startTime, playback.offset, playback.buffer, playback.source]);

  // Cleanup audio context when component unmounts
  useEffect(() => {
    return () => {
      if (playback.source) {
        playback.source.stop()
      }
      if (playback.context) {
        playback.context.close()
      }
    }
  }, [])

  // Initialize Web Worker
  useEffect(() => {
    workerRef.current = new Worker(new URL('./tts.worker.ts', import.meta.url), {
      type: 'module'
    })

    workerRef.current.onmessage = async (e) => {
      try {
        if (!e.data) {
          console.error('Received empty message from worker');
          return;
        }

        const { type, data } = e.data;
        console.debug('Worker message received:', { type, data: { ...data, audio: data?.audio ? `[Float32Array(${data.audio.length})]` : undefined } });

        if (!type) {
          console.error('Received message without type from worker');
          return;
        }

        switch (type) {
          case 'loading':
            setState(prev => ({
              ...prev,
              isLoading: true,
              loadingMessage: data.message
            }));
            break;

          case 'progress':
            try {
              // Safely handle progress updates
              const progress = typeof data?.progress === 'number' ? data.progress : 
                              typeof data?.data?.progress === 'number' ? data.data.progress : 0;
              
              console.debug('Progress update:', { 
                progress, 
                generationStartTime, 
                elapsedTime,
                raw: data
              });
              
              setState(prev => ({
                ...prev,
                generationProgress: progress
              }));
            } catch (error) {
              console.error('Error handling progress update:', error);
            }
            break;

          case 'model_loaded':
            setState(prev => ({
              ...prev,
              isLoading: false,
              loadingMessage: 'Model loaded successfully!'
            }))
            break

          case 'complete':
            try {
              // Validate audio data
              if (!data?.audio || !data?.sampling_rate) {
                console.error('Invalid audio data:', { 
                  hasAudio: !!data?.audio, 
                  audioLength: data?.audio?.length,
                  samplingRate: data?.sampling_rate 
                });
                throw new Error('Invalid audio data received from worker');
              }

              // Create audio context and buffer
              const audioContext = new AudioContext();
              const buffer = audioContext.createBuffer(1, data.audio.length, data.sampling_rate);
              buffer.copyToChannel(data.audio, 0);
              
              // Create audio source and connect directly
              const source = audioContext.createBufferSource();
              source.buffer = buffer;
              source.connect(audioContext.destination);
              source.playbackRate.value = state.speed;

              // Get voice details using the voice ID returned from worker
              const usedVoiceId = data.usedVoice;
              const voiceDetails = AVAILABLE_VOICES.find(v => v.id === usedVoiceId);
              
              if (!voiceDetails) {
                console.warn(`Voice details not found for ID: ${usedVoiceId}`);
              }

              // Log voice verification
              console.debug('Voice verification:', {
                selectedVoice,
                usedVoiceId,
                foundVoice: voiceDetails?.name,
                allVoices: AVAILABLE_VOICES.map(v => `${v.id}:${v.name}`).join(', ')
              });

              const generation: AudioGeneration = {
                id: crypto.randomUUID(),
                text,
                voice: voiceDetails?.name || 'Unknown Voice',
                voiceId: usedVoiceId, // Store the actual used voice ID
                timestamp: Date.now(),
                audio: data.audio,
                samplingRate: data.sampling_rate
              }

              // Log the generation for debugging
              console.debug('Creating generation:', {
                voice: voiceDetails?.name,
                voiceId: usedVoiceId,
                foundVoice: !!voiceDetails,
                generation
              });

              setState(prev => ({
                ...prev,
                history: [generation, ...prev.history].sort((a, b) => b.timestamp - a.timestamp),
                currentlyPlaying: generation.id,
                isLoading: false,
                isGenerating: false,
                isPlaying: true,
                generationProgress: 0
              }));

              // Reset timer state
              setGenerationStartTime(null);
              setElapsedTime(0);

              // Set up audio event listeners
              source.addEventListener('ended', () => {
                setState(prev => ({
                  ...prev,
                  isPlaying: false,
                  currentlyPlaying: null,
                  playbackProgress: 0,
                  currentTime: '0:00'
                }));
              });

              // Start playback
              source.start();
              
              // Cleanup audio context when done
              source.addEventListener('ended', () => {
                audioContext.close();
              });

            } catch (err) {
              const error = err as Error;
              console.error('Failed to setup audio playback:', error);
              setState(prev => ({
                ...prev,
                isPlaying: false,
                isGenerating: false,
                currentlyPlaying: null,
                error: `Failed to setup audio playback: ${error.message}`,
                generationProgress: 0
              }));
              // Reset timer on error too
              setGenerationStartTime(null);
              setElapsedTime(0);
            }
            break;

          case 'error':
            console.error('TTS generation error:', data.error);
            setState(prev => ({
              ...prev,
              isLoading: false,
              isGenerating: false,
              error: `Failed to generate speech: ${data.error}`,
              generationProgress: 0
            }));
            // Reset timer on error
            setGenerationStartTime(null);
            setElapsedTime(0);
            break;
        }
      } catch (error) {
        console.error('Error handling worker message:', error);
        setState(prev => ({
          ...prev,
          isLoading: false,
          isGenerating: false,
          error: 'An error occurred while processing the request'
        }));
      }
    }

    // Trigger model initialization immediately
    workerRef.current.postMessage({ type: 'init' });

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  // Initialize IndexedDB
  const openDB = async () => {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kokoro-tts', 1)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('history')) {
          db.createObjectStore('history', { keyPath: 'id' })
        }
      }
    })
  }

  const handleSpeak = async () => {
    if (!text.trim() || !workerRef.current || state.isGenerating) return

    try {
      // Start timer immediately when generation starts
      setGenerationStartTime(Date.now());
      
      setState(prev => ({ 
        ...prev, 
        error: null,
        isGenerating: true,
        loadingMessage: 'Generating speech...',
        generationProgress: 0 // Reset progress
      }))

      workerRef.current.postMessage({
        text,
        voice: selectedVoice,
        speed: state.speed,
        volume: state.volume
      })
    } catch (error: any) {
      console.error('Failed to generate speech:', error)
      setState(prev => ({
        ...prev,
        isPlaying: false,
        isLoading: false,
        isGenerating: false,
        currentlyPlaying: null,
        error: `Failed to generate speech: ${error?.message || String(error)}`
      }))
      // Reset timer on error
      setGenerationStartTime(null);
      setElapsedTime(0);
    }
  }

  const deleteFromHistory = async (id: string) => {
    try {
      const db = await openDB()
      const tx = db.transaction('history', 'readwrite')
      const store = tx.objectStore('history')
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(id)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      
      setState(prev => ({
        ...prev,
        history: prev.history.filter(item => item.id !== id)
      }))
    } catch (error) {
      console.error('Failed to delete from history:', error)
    }
  }

  // Cleanup function for component unmount
  useEffect(() => {
    return () => {
      if (playback.source) {
        playback.source.onended = null;
        playback.source.stop();
      }
      if (playback.context) {
        playback.context.close();
      }
      if (playAnimationRef.current) {
        cancelAnimationFrame(playAnimationRef.current);
        playAnimationRef.current = null;
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Update timer effect
  useEffect(() => {
    let timer: number;
    
    if (state.isGenerating && generationStartTime) {
      console.debug('Starting timer interval', {
        isGenerating: state.isGenerating,
        generationStartTime,
        currentElapsed: elapsedTime
      });
      
      // Initial update
      const initialElapsed = Math.floor((Date.now() - generationStartTime) / 1000);
      setElapsedTime(initialElapsed);
      
      // Set up interval
      timer = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - generationStartTime) / 1000);
        console.debug('Timer update:', { 
          elapsed, 
          generationStartTime,
          isGenerating: state.isGenerating 
        });
        setElapsedTime(elapsed);
      }, 1000);
    }
    
    return () => {
      if (timer) {
        console.debug('Cleaning up timer', {
          isGenerating: state.isGenerating,
          hadTimer: !!timer
        });
        clearInterval(timer);
      }
    };
  }, [state.isGenerating, generationStartTime]);

  // Add cleanup effect
  useEffect(() => {
    if (!state.isGenerating) {
      console.debug('Resetting generation state', {
        generationStartTime,
        elapsedTime,
        progress: state.generationProgress
      });
      setGenerationStartTime(null);
      setElapsedTime(0);
      setState(prev => ({
        ...prev,
        generationProgress: 0
      }));
    }
  }, [state.isGenerating]);

  return (
    <div className="container">
      <header className="header">
        KOKORO TTS
      </header>
      
      <main className="grid">
        {state.error && (
          <div style={{ color: 'var(--accent-color)', marginBottom: 'var(--grid-unit)', fontFamily: 'var(--font-mono)' }}>
            {state.error}
          </div>
        )}

        {state.isLoading && (
          <div className="loading-overlay">
            <div className="loading-content">
              <div className="loading-spinner"></div>
              <p>{state.loadingMessage}</p>
              <small style={{ marginTop: '8px', opacity: 0.7 }}>
                This is a one-time download (~86MB)
              </small>
            </div>
          </div>
        )}

        <div className="voice-grid">
          {state.voices.map(voice => (
            <button
              key={voice.id}
              className={`voice-button ${selectedVoice === voice.id ? 'voice-button-selected' : ''}`}
              onClick={() => {
                console.debug('Selecting voice:', voice);
                setSelectedVoice(voice.id);
              }}
              disabled={state.isLoading || state.isPlaying}
            >
              <div className="voice-name">{voice.name}</div>
              <div className="voice-details">
                {voice.gender} • {voice.language}
              </div>
            </button>
          ))}
        </div>

        <div className="controls-grid">
          <div className="control">
            <label htmlFor="speed">Speed</label>
            <input
              id="speed"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={state.speed}
              onChange={(e) => setState(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
              disabled={state.isLoading || state.isPlaying}
            />
            <span>{state.speed.toFixed(1)}x</span>
          </div>

          <div className="control">
            <label htmlFor="volume">Volume</label>
            <input
              id="volume"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={state.volume}
              onChange={(e) => setState(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
              disabled={state.isLoading || state.isPlaying}
            />
            <span>{(state.volume * 100).toFixed(0)}%</span>
          </div>
        </div>

        <textarea
          className="input textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to convert to speech..."
          disabled={state.isLoading || state.isPlaying}
        />

        <button
          className="button"
          onClick={handleSpeak}
          disabled={state.isLoading || state.isPlaying || state.isGenerating || !text.trim()}
        >
          {state.isGenerating ? 'GENERATING...' : 'GENERATE'}
        </button>

        {state.isGenerating && (
          <div className="generation-progress">
            <div className="generation-progress-bar">
              <div 
                className="generation-progress-fill"
                style={{ width: `${state.generationProgress * 100}%` }}
              />
            </div>
            <div className="generation-status">
              <span>Generating audio...</span>
              <span className="generation-timer">{elapsedTime}s</span>
            </div>
          </div>
        )}

        {state.history.length > 0 && (
          <div className="history-section">
            <h2 className="history-title">History</h2>
            <div className="history-grid">
              {state.history.map((item) => (
                <div key={item.id} className="history-item">
                  <AudioPlayer
                    audio={item.audio}
                    samplingRate={item.samplingRate}
                    id={item.id}
                    onPlaybackEnd={() => {
                      setState(prev => ({
                        ...prev,
                        isPlaying: false,
                        currentlyPlaying: null,
                        playbackProgress: 0
                      }));
                    }}
                  />
                  <div className="audio-info">
                    <div className="text-preview">{item.text}</div>
                    <div className="audio-metadata">
                      <div className="metadata-item">
                        <span className="metadata-label">VOICE:</span>
                        <span>{item.voice}</span>
                      </div>
                      <div className="metadata-item">
                        <span className="metadata-label">SR:</span>
                        <span>{item.samplingRate}Hz</span>
                      </div>
                      <div className="metadata-item">
                        <span className="metadata-label">LEN:</span>
                        <span>{formatTime(item.audio.length / item.samplingRate)}</span>
                      </div>
                    </div>
                    <div className="timestamp-group">
                      <span className="timestamp">{item.timestamp}</span>
                      <div className="history-actions">
                        <button className="delete-button" onClick={() => deleteFromHistory(item.id)}>Delete</button>
                        <button className="download-button" onClick={() => handleDownload(item.audio, item.samplingRate, item.text)}>Download</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App