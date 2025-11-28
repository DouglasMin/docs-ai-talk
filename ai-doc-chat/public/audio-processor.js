/**
 * AudioWorklet Processor for Nova Sonic
 * Based on AWS official example
 * Buffers audio to send larger chunks (reduces network overhead and improves quality)
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer size: 4096 samples = ~256ms at 16kHz (good balance)
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input && input.length > 0) {
      const channelData = input[0];
      
      // Add samples to buffer
      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.bufferIndex++] = channelData[i];
        
        // When buffer is full, convert and send
        if (this.bufferIndex >= this.bufferSize) {
          // Convert Float32Array to Int16Array
          const int16Data = new Int16Array(this.bufferSize);
          for (let j = 0; j < this.bufferSize; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            int16Data[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          // Send to main thread
          this.port.postMessage({
            type: 'audio',
            data: int16Data
          });
          
          // Reset buffer
          this.bufferIndex = 0;
        }
      }
    }
    
    return true; // Continue processing
  }
}

registerProcessor('audio-processor', AudioProcessor);
