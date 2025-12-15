/**
 * Bedrock client wrapper for Nova Sonic
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { Readable } from 'stream';
import { config } from '../aws-config';
import { MODEL_ID } from './config';
import type { NovaSession } from './session';

interface ResponseStreamEvent {
  chunk?: {
    bytes?: Uint8Array;
  };
}

interface ParsedNovaEvent {
  event?: {
    contentStart?: {
      type?: string;
      role?: string;
      additionalModelFields?: string;
    };
    textOutput?: {
      content: string;
      role?: string;
    };
    audioOutput?: {
      content?: string;
    };
    toolUse?: {
      toolUseId?: string;
      toolName?: string;
      input?: Record<string, unknown>;
    };
    contentEnd?: {
      stopReason?: string;
    };
  };
}

/**
 * Convert async generator to Readable stream
 * The generator yields objects with { chunk: { bytes: Uint8Array } } format
 * We need to convert this to a Buffer stream for AWS SDK
 */
function asyncGeneratorToStream(
  generator: AsyncGenerator<{ chunk: { bytes: Uint8Array } }>
): Readable {
  const stream = new Readable({
    objectMode: false, // Binary mode, not object mode
    read() {
      // Generator will be consumed by the async function below
    },
  });

  // Consume generator and push to stream
  (async () => {
    try {
      console.log('[NovaClient] Starting to consume generator...');
      for await (const item of generator) {
        // Debug: Log item structure
        if (!item) {
          console.warn('[NovaClient] Received null/undefined item from generator');
          continue;
        }

        // Extract bytes from chunk and push as Buffer
        if (item && item.chunk && item.chunk.bytes !== undefined) {
          // Check if bytes is already a number (shouldn't happen, but handle it)
          if (typeof item.chunk.bytes === 'number') {
            console.error('[NovaClient] ERROR: bytes is a number!', item.chunk.bytes);
            console.error('[NovaClient] Full item:', JSON.stringify(item, null, 2));
            continue;
          }

          // Ensure bytes is a Uint8Array
          let bytes: Uint8Array;
          if (item.chunk.bytes instanceof Uint8Array) {
            bytes = item.chunk.bytes;
          } else if (Array.isArray(item.chunk.bytes)) {
            bytes = new Uint8Array(item.chunk.bytes);
          } else {
            try {
              bytes = new Uint8Array(item.chunk.bytes);
            } catch (e) {
              console.error('[NovaClient] Cannot convert bytes to Uint8Array:', typeof item.chunk.bytes, item.chunk.bytes);
              continue;
            }
          }
          
          const buffer = Buffer.from(bytes);
          if (!stream.push(buffer)) {
            // Stream is full, wait for drain
            await new Promise((resolve) => stream.once('drain', resolve));
          }
        } else {
          console.warn('[NovaClient] Invalid chunk format:', JSON.stringify(item, null, 2));
        }
      }
      console.log('[NovaClient] Generator consumption complete, ending stream');
      stream.push(null); // End stream
    } catch (error) {
      console.error('[NovaClient] Stream generation error:', error);
      console.error('[NovaClient] Error stack:', error instanceof Error ? error.stack : 'No stack');
      stream.destroy(error as Error);
    }
  })();

  return stream;
}

export class NovaClient {
  private bedrockClient: BedrockRuntimeClient;
  private currentGenerationStage: string = 'FINAL'; // Track generation stage for text filtering

  constructor() {
    // HTTP/2 handler for bidirectional streaming
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: 300000,
      sessionTimeout: 300000,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 20,
    });

    // Bedrock client
    this.bedrockClient = new BedrockRuntimeClient({
      region: config.aws.region,
      // credentials: config.aws.credentials,
      requestHandler: nodeHttp2Handler,
    });
  }

  /**
   * Start streaming session with Nova Sonic
   * Based on AWS official documentation: https://docs.aws.amazon.com/ko_kr/nova/latest/userguide/speech-bidirection.html
   */
  async startStream(
    session: NovaSession,
    onAudioChunk: (audio: Uint8Array) => void,
    onText: (text: string) => void,
    onToolUse: (toolUseId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<void>,
    onContentEnd?: (stopReason: string) => void
  ) {
    try {
      console.log('[NovaClient] Creating command with modelId:', MODEL_ID);
      
      // Create command with async generator (AWS official pattern)
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: MODEL_ID,
        body: session.generateEventStream(),
      });
      console.log('[NovaClient] Command created, sending to Bedrock...');

      // IMPORTANT: Don't await here! Let generator run first
      // Based on working example: nova-sonic-example/server.js line 247
      this.bedrockClient.send(command).then(async (response) => {
        console.log('[NovaClient] Response received from Bedrock');
        
        // Use response.body for streaming
        const responseStream = response.body as AsyncIterable<ResponseStreamEvent> | undefined;
        
        if (!responseStream) {
          console.error('[NovaClient] No response stream found!');
          throw new Error('No response stream available');
        }
        
        console.log('[NovaClient] Starting to process response stream...');
        await this.processResponses(responseStream, onAudioChunk, onText, onToolUse, onContentEnd);
        
      }).catch((error) => {
        console.error('[NovaClient] Bedrock error:', error);
        console.error('[NovaClient] Error stack:', error.stack);
        throw error;
      });
      
      // Wait for generator to send initial events
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      console.log('[NovaClient] Initial events sent, stream started');
      
    } catch (error) {
      console.error('[NovaClient] startStream error:', error);
      throw error;
    }
  }
  
  private async processResponses(
    responseStream: AsyncIterable<ResponseStreamEvent>,
    onAudioChunk: (audio: Uint8Array) => void,
    onText: (text: string) => void,
    onToolUse: (toolUseId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<void>,
    onContentEnd?: (stopReason: string) => void
  ) {
    try {
      const textDecoder = new TextDecoder();
      let responseCount = 0;
      
      console.log('[NovaClient] Processing response stream...');
      
      for await (const event of responseStream) {
        if (!event) continue;
        
        responseCount++;

        // Handle chunk with bytes (as per AWS documentation)
        if (event.chunk?.bytes) {
          try {
            const textResponse = textDecoder.decode(event.chunk.bytes);
            const jsonResponse = JSON.parse(textResponse) as ParsedNovaEvent;

            if (jsonResponse.event) {
              // Handle contentStart - track generation stage
              // Based on AWS example: https://github.com/aws-samples/aws-bedrock-examples
              if (jsonResponse.event.contentStart) {
                const contentStart = jsonResponse.event.contentStart;
                const type = contentStart.type;
                const role = contentStart.role;
                
                // Track generation stage for text filtering
                let generationStage = 'FINAL';
                if (contentStart.additionalModelFields) {
                  try {
                    const additionalFields = JSON.parse(contentStart.additionalModelFields);
                    generationStage = additionalFields.generationStage || 'FINAL';
                  } catch (e) {
                    // Use default
                  }
                }
                
                // Store generation stage for text filtering
                this.currentGenerationStage = generationStage;
                console.log(`[NovaClient] Content start: ${type} (${role}) - ${generationStage}`);
              }

              // Handle textOutput
              // Based on AWS example: https://github.com/aws-samples/aws-bedrock-examples
              // USER role = ASR transcription (what user said) - don't display
              // ASSISTANT role with SPECULATIVE = preview (what model plans to say) - don't display
              // ASSISTANT role with FINAL = actual response (what model said) - display this
              if (jsonResponse.event.textOutput) {
                const textOutput = jsonResponse.event.textOutput;
                const textContent = textOutput.content;
                const role = textOutput.role || 'ASSISTANT';
                
                // Check for barge-in
                if (textContent.includes('{ "interrupted" : true }')) {
                  console.log('[NovaClient] User interrupted (barge-in)');
                  // Barge-in handling will be done by client
                }

                // Only send ASSISTANT FINAL text to client (actual model response)
                // Ignore: USER (ASR), ASSISTANT SPECULATIVE (preview)
                if (role === 'ASSISTANT' && this.currentGenerationStage === 'FINAL') {
                  onText(textContent);
                  console.log(`[NovaClient] ASSISTANT (FINAL): ${textContent.substring(0, 50)}...`);
                } else if (role === 'ASSISTANT' && this.currentGenerationStage === 'SPECULATIVE') {
                  console.log(`[NovaClient] ASSISTANT (SPECULATIVE - ignored): ${textContent.substring(0, 50)}...`);
                }
              }

              // Handle audioOutput
              if (jsonResponse.event.audioOutput) {
                const audioContent = jsonResponse.event.audioOutput.content;
                console.log('[NovaClient] Received audioOutput, length:', audioContent?.length || 0);
                try {
                  const audioData = Buffer.from(audioContent, 'base64');
                  console.log('[NovaClient] Decoded audio data:', audioData.length, 'bytes');
                  onAudioChunk(audioData);
                } catch (audioError) {
                  console.error('[NovaClient] Error processing audio:', audioError);
                }
              }

              // Handle toolUse
              if (jsonResponse.event.toolUse) {
                const toolUse = jsonResponse.event.toolUse;
                const toolUseId = toolUse.toolUseId || '';
                const toolName = toolUse.toolName || '';
                const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;
                
                await onToolUse(toolUseId, toolName, toolInput);
              }

              // Handle contentEnd
              if (jsonResponse.event.contentEnd) {
                const contentEnd = jsonResponse.event.contentEnd;
                const stopReason = contentEnd.stopReason || 'COMPLETE';
                console.log('[NovaClient] Content ended:', stopReason);
                
                onContentEnd?.(stopReason);
              }

              // Handle completionEnd
              if (jsonResponse.event.completionEnd) {
                console.log('[NovaClient] Completion ended');
                break;
              }
            }
          } catch (parseError) {
            console.error('[NovaClient] Error parsing JSON response:', parseError);
            console.log('[NovaClient] Raw response:', textDecoder.decode(event.chunk.bytes));
          }
        }
        // Handle modelStreamErrorException
        else if (event.modelStreamErrorException) {
          console.error('[NovaClient] Model stream error:', event.modelStreamErrorException);
          throw new Error(`Model stream error: ${event.modelStreamErrorException.message}`);
        }
        // Handle internalServerException
        else if (event.internalServerException) {
          console.error('[NovaClient] Internal server error:', event.internalServerException);
          throw new Error(`Internal server error: ${event.internalServerException.message}`);
        }
      }
    } catch (streamError) {
      console.error('[NovaClient] Stream iteration error:', streamError);
      // Don't throw, just log - the stream might have ended normally
    }
  }
}
