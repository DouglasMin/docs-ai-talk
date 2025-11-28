/**
 * Configuration constants for Nova Sonic
 */

export const MODEL_ID = 'amazon.nova-sonic-v1:0';

export const DEFAULT_INFERENCE_CONFIG = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0,
};

export const DEFAULT_AUDIO_INPUT_CONFIG = {
  mediaType: 'audio/lpcm' as const,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
  audioType: 'SPEECH' as const,
  encoding: 'base64' as const,
};

export const DEFAULT_AUDIO_OUTPUT_CONFIG = {
  mediaType: 'audio/lpcm' as const,
  sampleRateHertz: 24000,
  sampleSizeBits: 16,
  channelCount: 1,
  encoding: 'base64' as const,
  audioType: 'SPEECH' as const,
};

export const DEFAULT_TEXT_CONFIG = {
  mediaType: 'text/plain' as const,
};

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful voice assistant that answers questions about uploaded documents.

When users ask questions, use the query_documents tool to search for relevant information in the uploaded documents.

Always provide clear, concise answers based on the document content.`;
