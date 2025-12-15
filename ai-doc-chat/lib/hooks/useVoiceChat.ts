/**
 * useVoiceChat Hook
 * Handles Nova Sonic voice chat with WebSocket
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseVoiceChatOptions {
  selectedDoc?: string | null;
  onError?: (error: string) => void;
}

export interface VoiceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isVoice: boolean;
}

export function useVoiceChat(options: UseVoiceChatOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceMessages, setVoiceMessages] = useState<VoiceMessage[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
  const currentUserTranscript = useRef<string>('');
  const currentAssistantTranscript = useRef<string>('');
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingAudioRef = useRef<boolean>(false);
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const isRecordingRef = useRef<boolean>(false); // Add ref for isRecording

  // Helper: Base64 → ArrayBuffer
  const base64ToArrayBuffer = useCallback((base64: string): ArrayBuffer => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }, []);

  // Helper: Int16 → Float32 conversion
  // Based on AWS official example: https://github.com/aws-samples/aws-bedrock-examples
  // Nova Sonic outputs: 16-bit signed PCM, little-endian
  // Format: 16-bit signed integer, little-endian, base64 encoded
  const convertInt16ToFloat32 = useCallback((bytes: Uint8Array): Float32Array => {
    // Ensure we have an even number of bytes (16-bit = 2 bytes per sample)
    if (bytes.length % 2 !== 0) {
      console.warn('⚠️ Odd number of bytes, truncating last byte');
      bytes = bytes.slice(0, bytes.length - 1);
    }
    
    // Convert Uint8Array to Int16Array
    // Create a new ArrayBuffer to ensure proper alignment
    const buffer = new ArrayBuffer(bytes.length);
    const view = new Uint8Array(buffer);
    view.set(bytes);
    
    // Create Int16Array from the buffer (little-endian by default in JavaScript)
    const int16Array = new Int16Array(buffer);
    
    // Convert Int16 to Float32
    // Based on example: int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF)
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      // Int16 범위: -32768 ~ 32767
      // Float32 범위: -1.0 ~ 1.0
      // 음수: / 0x8000 (32768), 양수: / 0x7FFF (32767)
      const int16 = int16Array[i];
      float32Array[i] = int16 / (int16 < 0 ? 0x8000 : 0x7FFF);
    }
    
    return float32Array;
  }, []);

  // Sequential playback (prevents audio glitches)
  // Based on AWS official documentation: https://docs.aws.amazon.com/nova/latest/userguide/output-events.html
  // Improved: Use precise timing to prevent gaps between chunks
  const playNextAudioChunk = useCallback(function handlePlayNextAudioChunk() {
    if (audioQueueRef.current.length === 0) {
      isPlayingAudioRef.current = false;
      return;
    }
    
    isPlayingAudioRef.current = true;
    const float32Array = audioQueueRef.current.shift()!;
    
    // Get or create audio context for playback (separate from input context)
    // Sample rate must match audioOutputConfiguration: 24000 Hz
    if (!playbackAudioContextRef.current) {
      playbackAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const audioContext = playbackAudioContextRef.current;
    
    // Resume context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(err => {
        console.error('Error resuming audio context:', err);
      });
    }
    
    try {
      // ⚠️ 중요: 24000Hz로 버퍼 생성 (audioOutputConfiguration과 일치)
      // Format: 1 channel (mono), 24000 Hz sample rate
      const audioBuffer = audioContext.createBuffer(
        1,                      // 채널 수 (모노) - channelCount: 1
        float32Array.length,    // 샘플 수
        24000                   // 샘플레이트 24000Hz - sampleRateHertz: 24000
      );
      
      // Copy float32Array to buffer channel
      // Validate and clamp values to prevent distortion
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < float32Array.length; i++) {
        // Clamp values to [-1.0, 1.0] to prevent clipping
        channelData[i] = Math.max(-1.0, Math.min(1.0, float32Array[i]));
      }
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      
      // 현재 청크 끝나면 다음 청크 재생 (순차 재생으로 끊김 방지)
      // Use onended callback for seamless playback
      source.onended = () => {
        // Schedule next chunk immediately to prevent gaps
        handlePlayNextAudioChunk();
      };
      
      // Start playback immediately
      source.start(0);
      
      if (float32Array.length > 0) {
        console.log('🔊 Playing audio chunk:', float32Array.length, 'samples, queue:', audioQueueRef.current.length);
      }
    } catch (error) {
      console.error('❌ Audio playback error:', error);
      // Continue with next chunk even if this one fails
      handlePlayNextAudioChunk();
    }
  }, []);

  // Add audio to queue and start playback if not playing
  const addAudioToQueue = useCallback((base64Audio: string) => {
    try {
      if (!base64Audio || base64Audio.length === 0) {
        console.warn('⚠️ Empty audio data received');
        return;
      }
      
      // 1. Base64 → ArrayBuffer
      const audioData = base64ToArrayBuffer(base64Audio);
      
      if (audioData.byteLength === 0) {
        console.warn('⚠️ Empty audio buffer after base64 decode');
        return;
      }
      
      // 2. Uint8Array로 변환 (바이트 단위 접근)
      const bytes = new Uint8Array(audioData);
      
      // 3. Int16 (little-endian) → Float32 변환
      const float32Array = convertInt16ToFloat32(bytes);
      
      if (float32Array.length === 0) {
        console.warn('⚠️ Empty float32 array after conversion');
        return;
      }
      
      // 4. 큐에 추가
      audioQueueRef.current.push(float32Array);
      
      // 5. 재생 시작 (재생 중이 아니면)
      if (!isPlayingAudioRef.current) {
        playNextAudioChunk();
      }
    } catch (error) {
      console.error('❌ Error adding audio to queue:', error);
      console.error('❌ Base64 length:', base64Audio?.length || 0);
    }
  }, [base64ToArrayBuffer, convertInt16ToFloat32, playNextAudioChunk]);

  // Initialize audio context
  const initAudio = useCallback(async () => {
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Create audio context
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      // Load audio worklet for processing
      await audioContext.audioWorklet.addModule('/audio-processor.js');

      // Create worklet node
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      
      workletNode.port.onmessage = (event) => {
        // Handle audio data from AudioWorklet
        // Based on AWS example: event.data has { type: 'audio', data: Int16Array }
        // IMPORTANT: Use ref instead of state to avoid stale closure
        if (!isRecordingRef.current) {
          console.log('⚠️ Audio received but not recording');
          return;
        }
        
        if (event.data.type === 'audio') {
          const int16Data = event.data.data;
          
          // Validate audio data
          if (!int16Data || int16Data.length === 0) {
            return;
          }
          
          // Convert Int16Array to base64 for WebSocket
          const base64Audio = arrayBufferToBase64(int16Data.buffer);
          
          // Send audio data to WebSocket
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'audio',
              audio: base64Audio
            }));
            console.log('🎤 Sent audio chunk:', base64Audio.length, 'chars');
          } else {
            console.warn('⚠️ WebSocket not open, cannot send audio');
          }
        }
      };

      source.connect(workletNode);
      // Don't connect to destination - we only want to process audio, not play it
      
      audioWorkletRef.current = workletNode;

      return true;
    } catch (error) {
      console.error('Audio initialization error:', error);
      options.onError?.('Failed to access microphone');
      return false;
    }
  }, [options]);

  // Start voice chat
  const startVoice = useCallback(async () => {
    // Initialize audio
    const audioReady = await initAudio();
    if (!audioReady) return;

    // Connect WebSocket
    const ws = new WebSocket('ws://localhost:3000/api/voice-ws');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('🔌 WebSocket connected');
      setIsConnected(true);
      
      // Start session
      ws.send(JSON.stringify({
        type: 'start',
        voiceId: 'matthew',
        docId: options.selectedDoc || undefined
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'ready') {
        setIsRecording(true);
        isRecordingRef.current = true; // Update ref
        console.log('✅ Session ready, recording enabled');
      }
      
      else if (message.type === 'audio') {
        // Add audio to queue for sequential playback
        addAudioToQueue(message.data);
      }
      
      else if (message.type === 'text') {
        // Accumulate assistant transcript
        currentAssistantTranscript.current += message.text;
        setTranscript(currentAssistantTranscript.current);
      }
      
      else if (message.type === 'contentEnd') {
        // Save assistant message to history
        if (currentAssistantTranscript.current) {
          const assistantMessage: VoiceMessage = {
            id: Date.now().toString(),
            role: 'assistant',
            content: currentAssistantTranscript.current,
            timestamp: new Date(),
            isVoice: true,
          };
          setVoiceMessages(prev => [...prev, assistantMessage]);
          currentAssistantTranscript.current = '';
        }
      }
      
      else if (message.type === 'error') {
        console.error('Voice error:', message.error);
        options.onError?.(message.error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      options.onError?.('Connection error');
    };

    ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      setIsConnected(false);
      setIsRecording(false);
      isRecordingRef.current = false; // Update ref
    };
  }, [initAudio, options]);

  // Stop voice chat
  const stopVoice = useCallback(() => {
    // Stop WebSocket
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop audio
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Clear audio queue
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (playbackAudioContextRef.current) {
      playbackAudioContextRef.current.close();
      playbackAudioContextRef.current = null;
    }

    setIsRecording(false);
    setIsConnected(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVoice();
    };
  }, [stopVoice]);

  return {
    isRecording,
    isConnected,
    transcript,
    voiceMessages,
    startVoice,
    stopVoice,
  };
}

// Helper: Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
