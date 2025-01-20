import React, { useState, useEffect, useRef, useCallback } from 'react';
import './AudioPlayer.css';

interface AudioPlayerProps {
  audio: Float32Array;
  samplingRate: number;
  onPlaybackEnd?: () => void;
  id: string;
}

interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

export const AudioPlayer = ({ audio, samplingRate, onPlaybackEnd }: AudioPlayerProps) => {
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1
  });
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const seekTimeRef = useRef<number>(0);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Format time in MM:SS
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Initialize audio context and buffer
  useEffect(() => {
    const initAudio = async () => {
      const context = new AudioContext();
      const buffer = context.createBuffer(1, audio.length, samplingRate);
      buffer.copyToChannel(audio, 0);
      
      audioContextRef.current = context;
      bufferRef.current = buffer;
      
      setPlayback(prev => ({
        ...prev,
        duration: buffer.duration
      }));
    };
    
    initAudio();
    
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [audio, samplingRate]);

  // Handle playback updates
  const updatePlayback = useCallback(() => {
    if (!audioContextRef.current || !bufferRef.current) return;
    
    const currentTime = audioContextRef.current.currentTime - startTimeRef.current + seekTimeRef.current;
    
    if (currentTime >= bufferRef.current.duration) {
      stopPlayback();
      if (onPlaybackEnd) onPlaybackEnd();
      return;
    }
    
    setPlayback(prev => ({
      ...prev,
      currentTime
    }));
    
    animationRef.current = requestAnimationFrame(updatePlayback);
  }, [onPlaybackEnd]);

  // Start playback
  const startPlayback = useCallback(() => {
    if (!audioContextRef.current || !bufferRef.current) return;
    
    // Create new source node
    const source = audioContextRef.current.createBufferSource();
    source.buffer = bufferRef.current;
    
    // Create gain node if needed
    if (!gainNodeRef.current) {
      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = playback.volume;
      gainNode.connect(audioContextRef.current.destination);
      gainNodeRef.current = gainNode;
    }
    
    // Connect nodes
    source.connect(gainNodeRef.current);
    
    // Start playback from current position
    startTimeRef.current = audioContextRef.current.currentTime;
    source.start(0, seekTimeRef.current);
    sourceNodeRef.current = source;
    
    // Start animation
    animationRef.current = requestAnimationFrame(updatePlayback);
    
    setPlayback(prev => ({ ...prev, isPlaying: true }));
  }, [playback.volume, updatePlayback]);

  // Stop playback
  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Reset position on completion
    seekTimeRef.current = 0;
    setPlayback(prev => ({ 
      ...prev, 
      isPlaying: false,
      currentTime: 0
    }));
  }, []);

  // Handle play/pause
  const togglePlayback = useCallback(() => {
    if (playback.isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [playback.isPlaying, startPlayback, stopPlayback]);

  // Handle volume change
  const handleVolumeChange = useCallback((value: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = value;
    }
    setPlayback(prev => ({ ...prev, volume: value }));
  }, []);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const timeline = timelineRef.current;
    if (!timeline || !bufferRef.current) return;
    
    isDragging.current = true;
    document.body.style.userSelect = 'none';
    
    // Initial position update
    const rect = timeline.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = position * bufferRef.current.duration;
    
    seekTimeRef.current = seekTime;
    setPlayback(prev => ({
      ...prev,
      currentTime: seekTime
    }));
    
    if (playback.isPlaying) {
      stopPlayback();
    }
    
    const updateDragPosition = (e: MouseEvent) => {
      if (!isDragging.current || !timeline || !bufferRef.current) return;
      
      const rect = timeline.getBoundingClientRect();
      const position = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const seekTime = position * bufferRef.current.duration;
      
      seekTimeRef.current = seekTime;
      setPlayback(prev => ({
        ...prev,
        currentTime: seekTime
      }));
    };
    
    const stopDragging = () => {
      if (!isDragging.current) return;
      
      isDragging.current = false;
      document.body.style.userSelect = '';
      
      document.removeEventListener('mousemove', updateDragPosition);
      document.removeEventListener('mouseup', stopDragging);
      
      if (playback.isPlaying) {
        startPlayback();
      }
    };
    
    document.addEventListener('mousemove', updateDragPosition);
    document.addEventListener('mouseup', stopDragging);
  }, [playback.isPlaying, startPlayback, stopPlayback]);

  return (
    <div className="audio-player">
      <div className="audio-controls">
        <button 
          className="play-button"
          onClick={togglePlayback}
          aria-label={playback.isPlaying ? 'Pause' : 'Play'}
        >
          {playback.isPlaying ? (
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 5v14l11-7z" fill="currentColor"/>
            </svg>
          )}
        </button>

        <span className="time-display">{formatTime(playback.currentTime)}</span>
        
        <div className="waveform">
          <div 
            className="waveform-progress" 
            style={{ 
              width: `${(playback.currentTime / playback.duration) * 100}%`
            }}
          />
          <div 
            className="timeline-track"
            ref={timelineRef}
            onMouseDown={handleDragStart}
          >
            <div 
              className="progress-dot"
              style={{ 
                left: `${(playback.currentTime / playback.duration) * 100}%`
              }}
            />
          </div>
        </div>

        <span className="time-display">-{formatTime(playback.duration - playback.currentTime)}</span>
        
        <div className="volume-control">
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={playback.volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}; 