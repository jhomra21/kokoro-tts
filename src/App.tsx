import { useState, useEffect, useRef } from 'react'
import { KokoroTTS } from 'kokoro-js'
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
  timestamp: number;
  audio: Float32Array;
  audioUrl?: string;
  samplingRate: number;
}

interface AudioPlayback {
  context: AudioContext | null;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  startTime: number;
  pauseTime: number;
  duration: number;
  buffer: AudioBuffer | null;
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
}

function App() {
  const [text, setText] = useState('')
  const [tts, setTTS] = useState<any>(null)
  const [selectedVoice, setSelectedVoice] = useState('af_sky')
  const workerRef = useRef<Worker | null>(null)
  const [playback, setPlayback] = useState<AudioPlayback>({
    context: null,
    source: null,
    gainNode: null,
    startTime: 0,
    pauseTime: 0,
    duration: 0,
    buffer: null
  })
  const [state, setState] = useState<TTSState>({
    isLoading: true,
    isPlaying: false,
    isGenerating: false,
    error: null,
    loadingMessage: 'Initializing TTS engine...',
    voices: [],
    speed: 1.0,
    volume: 1.0,
    history: [],
    currentlyPlaying: null,
    playbackProgress: 0,
    currentTime: '0:00',
    duration: '0:00'
  })

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

  // Update progress bar and time display
  useEffect(() => {
    let animationFrame: number

    const updateProgress = () => {
      if (state.isPlaying && playback.context && playback.startTime > 0 && playback.source) {
        const currentTime = playback.context.currentTime - playback.startTime
        const duration = playback.duration / playback.source.playbackRate.value
        const progress = currentTime / duration

        setState(prev => ({ 
          ...prev, 
          playbackProgress: Math.min(progress, 1),
          currentTime: formatTime(currentTime),
          duration: formatTime(duration)
        }))

        if (progress >= 1) {
          setState(prev => ({ 
            ...prev, 
            isPlaying: false, 
            currentlyPlaying: null,
            playbackProgress: 0,
            currentTime: '0:00'
          }))
          return
        }

        animationFrame = requestAnimationFrame(updateProgress)
      }
    }

    if (state.isPlaying) {
      animationFrame = requestAnimationFrame(updateProgress)
    }

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame)
      }
    }
  }, [state.isPlaying, playback])

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
      const { type, ...data } = e.data

      switch (type) {
        case 'progress':
          setState(prev => ({
            ...prev,
            loadingMessage: `Downloading model: ${Math.round(data.progress * 100)}%`
          }))
          break

        case 'model_loaded':
          // Initialize voices after model is loaded
          const voiceArray = [
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
          ]

          setState(prev => ({
            ...prev,
            voices: voiceArray,
            isLoading: false,
            loadingMessage: 'Model loaded successfully!'
          }))
          break

        case 'complete':
          try {
            // Create audio context and buffer
            const audioContext = new AudioContext();
            const buffer = audioContext.createBuffer(1, data.audio.length, data.sampling_rate);
            buffer.copyToChannel(data.audio, 0);
            
            // Create audio source and connect directly
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.playbackRate.value = state.speed;

            const generation: AudioGeneration = {
              id: crypto.randomUUID(),
              text,
              voice: selectedVoice,
              timestamp: Date.now(),
              audio: data.audio,
              samplingRate: data.sampling_rate
            }

            setState(prev => ({
              ...prev,
              history: [generation, ...prev.history],
              currentlyPlaying: generation.id,
              isLoading: false,
              isGenerating: false,
              isPlaying: true
            }))

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
              error: `Failed to setup audio playback: ${error.message}`
            }));
          }
          break;

        case 'error':
          console.error('TTS generation error:', data.error);
          setState(prev => ({
            ...prev,
            isLoading: false,
            isGenerating: false,
            error: `Failed to generate speech: ${data.error}`
          }));
          break;
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

  const setupAudioPlayback = async (audio: Float32Array, samplingRate: number) => {
    try {
      // Clean up existing playback
      if (playback.source) {
        playback.source.stop()
      }
      if (playback.context) {
        await playback.context.close()
      }

      // Create new audio context and buffer
      const context = new AudioContext()
      const buffer = context.createBuffer(1, audio.length, samplingRate)
      buffer.copyToChannel(audio, 0)
      
      // Create audio graph
      const source = context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = state.speed
      
      const gainNode = context.createGain()
      gainNode.gain.value = state.volume
      
      // Connect nodes
      source.connect(gainNode)
      gainNode.connect(context.destination)
      
      setPlayback({
        context,
        source,
        gainNode,
        startTime: 0,
        pauseTime: 0,
        duration: buffer.duration,
        buffer
      })

      return { source, context, gainNode }
    } catch (error) {
      console.error('Failed to setup audio playback:', error)
      setState(prev => ({ 
        ...prev, 
        isPlaying: false,
        currentlyPlaying: null,
        error: 'Failed to setup audio playback'
      }))
      throw error
    }
  }

  const seekAudio = (progress: number) => {
    if (!playback.context || !playback.source || !playback.buffer) return;
    
    // Stop current playback
    playback.source.stop();
    
    // Create new source
    const newSource = playback.context.createBufferSource();
    newSource.buffer = playback.buffer;
    newSource.playbackRate.value = state.speed;
    
    // Connect to gain node
    newSource.connect(playback.gainNode!);
    
    // Calculate new start time
    const seekTime = progress * playback.duration;
    
    // Update playback state
    setPlayback(prev => ({
      ...prev,
      source: newSource,
      startTime: playback.context!.currentTime - seekTime,
      pauseTime: seekTime
    }));
    
    // Start playback from new position
    newSource.start(0, seekTime);
    
    setState(prev => ({
      ...prev,
      isPlaying: true,
      playbackProgress: progress
    }));
  }

  const playAudio = (startTime: number = 0) => {
    if (!playback.context || !playback.buffer) return;
    
    // Create new source
    const source = playback.context.createBufferSource();
    source.buffer = playback.buffer;
    source.playbackRate.value = state.speed;
    
    // Connect to gain node
    source.connect(playback.gainNode!);
    
    // Start playback
    source.start(0, startTime);
    
    setPlayback(prev => ({
      ...prev,
      source,
      startTime: playback.context!.currentTime - startTime,
      pauseTime: startTime
    }));
    
    setState(prev => ({
      ...prev,
      isPlaying: true
    }));
  }

  const pauseAudio = () => {
    if (!playback.source || !playback.context) return;
    
    // Calculate current position
    const currentTime = playback.context.currentTime - playback.startTime;
    
    // Stop playback
    playback.source.stop();
    
    setPlayback(prev => ({
      ...prev,
      pauseTime: currentTime
    }));
    
    setState(prev => ({
      ...prev,
      isPlaying: false
    }));
  }

  const playFromHistory = async (generation: AudioGeneration) => {
    try {
      setState(prev => ({ 
        ...prev, 
        isPlaying: true, 
        currentlyPlaying: generation.id,
        duration: formatTime(generation.audio.length / generation.samplingRate)
      }))
      
      const { source, context, gainNode } = await setupAudioPlayback(generation.audio, generation.samplingRate)
      source.start()
      
      setPlayback(prev => ({
        ...prev,
        startTime: context.currentTime,
        pauseTime: 0
      }))
      
      source.onended = () => {
        setState(prev => ({ 
          ...prev, 
          isPlaying: false, 
          currentlyPlaying: null,
          playbackProgress: 0,
          currentTime: '0:00'
        }))
      }
      
      console.log('Playing from history with:', {
        speed: source.playbackRate.value,
        volume: gainNode.gain.value
      })
    } catch (error) {
      console.error('Failed to play from history:', error)
      setState(prev => ({ 
        ...prev, 
        isPlaying: false,
        currentlyPlaying: null,
        error: 'Failed to play audio from history'
      }))
    }
  }

  const handleSpeak = async () => {
    if (!text.trim() || !workerRef.current || state.isGenerating) return

    try {
      setState(prev => ({ 
        ...prev, 
        error: null,
        isGenerating: true,
        loadingMessage: 'Generating speech...'
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
              onClick={() => setSelectedVoice(voice.id)}
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
                style={{ 
                  width: state.loadingMessage.includes('%') 
                    ? state.loadingMessage.match(/\d+/)?.[0] + '%'
                    : '0%'
                }} 
              />
            </div>
            <div className="generation-status">{state.loadingMessage}</div>
          </div>
        )}

        {state.history.length > 0 && (
          <div className="history-section">
            <h2 className="history-title">History</h2>
            <div className="history-grid">
              {state.history.map(item => (
                <div key={item.id} className="history-item">
                  <div className="history-text">{item.text}</div>
                  <div className="history-meta">
                    <span className="timestamp">{new Date(item.timestamp).toLocaleString()}</span>
                    <span className="voice-badge">{state.voices.find(v => v.id === item.voice)?.name || item.voice}</span>
                  </div>
                  <div className="playback-controls">
                    <div className="progress-container">
                      <div 
                        className="progress-bar"
                        onClick={(e) => {
                          if (state.currentlyPlaying === item.id) {
                            const rect = e.currentTarget.getBoundingClientRect()
                            const progress = (e.clientX - rect.left) / rect.width
                            seekAudio(progress)
                          }
                        }}
                      >
                        <div 
                          className="progress-fill"
                          style={{ 
                            width: state.currentlyPlaying === item.id 
                              ? `${state.playbackProgress * 100}%` 
                              : '0%'
                          }}
                        />
                        <div className="time-markers">
                          {[0, 0.25, 0.5, 0.75, 1].map(progress => (
                            <div key={progress} className="time-marker">
                              {formatTime(progress * (item.audio.length / item.samplingRate))}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="playback-info">
                      <span>{state.currentTime}</span>
                      <span>•</span>
                      <span>{formatTime(item.audio.length / item.samplingRate)}</span>
                    </div>

                    <div className="controls-container">
                      <div className="history-actions">
                        <button
                          className="history-button"
                          onClick={() => {
                            if (state.currentlyPlaying === item.id) {
                              if (state.isPlaying) {
                                pauseAudio()
                              } else {
                                playAudio(playback.pauseTime)
                              }
                            } else {
                              playFromHistory(item)
                            }
                          }}
                          disabled={state.isPlaying && state.currentlyPlaying !== item.id}
                        >
                          {state.currentlyPlaying === item.id 
                            ? (state.isPlaying ? '⏸︎ PAUSE' : '▶ RESUME') 
                            : '▶ PLAY'}
                        </button>
                        <button
                          className="history-button history-button-delete"
                          onClick={() => deleteFromHistory(item.id)}
                          disabled={state.isPlaying && state.currentlyPlaying === item.id}
                        >
                          ✕ DELETE
                        </button>
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