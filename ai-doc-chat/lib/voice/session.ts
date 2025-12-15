/**
 * Session management for Nova Sonic streaming
 */

import { randomUUID } from 'crypto';
import { queryKnowledgeBase } from '../services/bedrock-service';
import {
  DEFAULT_INFERENCE_CONFIG,
  DEFAULT_AUDIO_INPUT_CONFIG,
  DEFAULT_AUDIO_OUTPUT_CONFIG,
  DEFAULT_TEXT_CONFIG,
  DEFAULT_SYSTEM_PROMPT,
} from './config';

interface SessionConfig {
  voiceId?: string;
  docId?: string;
}

type EventPayload = Record<string, unknown>;

interface EventWrapper {
  event: EventPayload;
}

export class NovaSession {
  public sessionId: string;
  private voiceId: string;
  private docId?: string;
  private audioQueue: EventWrapper[] = [];
  private toolResultQueue: EventPayload[] = [];
  private isActive: boolean = false;
  public sessionReady: boolean = false; // Add sessionReady flag
  private textEncoder = new TextEncoder();
  private promptName: string = '';
  private audioContentName: string = '';
  private audioContentStarted: boolean = false;

  constructor(sessionId: string, config: SessionConfig = {}) {
    this.sessionId = sessionId;
    this.voiceId = config.voiceId || 'matthew';
    this.docId = config.docId;
  }

  /**
   * Generate event stream for Bedrock
   */
  async *generateEventStream(): AsyncGenerator<{ chunk: { bytes: Uint8Array } }> {
    this.promptName = randomUUID();
    this.audioContentName = randomUUID();

    // 1. Send sessionStart first
    const sessionStartEvent = {
      event: {
        sessionStart: {
          inferenceConfiguration: DEFAULT_INFERENCE_CONFIG,
        },
      },
    };

    yield {
      chunk: {
        bytes: this.textEncoder.encode(JSON.stringify(sessionStartEvent)),
      },
    };

    console.log(`[Session ${this.sessionId}] sessionStart sent`);

    // 2. Send promptStart with tool configuration
    const promptStartEvent = {
      event: {
        promptStart: {
          promptName: this.promptName,
          textOutputConfiguration: DEFAULT_TEXT_CONFIG,
          audioInputConfiguration: DEFAULT_AUDIO_INPUT_CONFIG,
          audioOutputConfiguration: {
            ...DEFAULT_AUDIO_OUTPUT_CONFIG,
            voiceId: this.voiceId,
          },
          toolUseOutputConfiguration: {
            mediaType: 'application/json',
          },
          toolConfiguration: {
            tools: [
              {
                toolSpec: {
                  name: 'query_documents',
                  description: 'Search uploaded documents for relevant information',
                  inputSchema: {
                    json: JSON.stringify({
                      type: 'object',
                      properties: {
                        query: {
                          type: 'string',
                          description: 'The search query to find information in documents',
                        },
                      },
                      required: ['query'],
                    }),
                  },
                },
              },
            ],
          },
        },
      },
    };

    yield {
      chunk: {
        bytes: this.textEncoder.encode(JSON.stringify(promptStartEvent)),
      },
    };

    console.log(`[Session ${this.sessionId}] promptStart sent`);

    // 3. Send system prompt as first content
    const systemContentName = randomUUID();
    const systemContentStartEvent = {
      event: {
        contentStart: {
          promptName: this.promptName,
          contentName: systemContentName,
          type: 'TEXT',
          role: 'SYSTEM',
          interactive: false,
          textInputConfiguration: {
            mediaType: 'text/plain',
          },
        },
      },
    };

    yield {
      chunk: {
        bytes: this.textEncoder.encode(JSON.stringify(systemContentStartEvent)),
      },
    };

    const systemTextEvent = {
      event: {
        textInput: {
          promptName: this.promptName,
          contentName: systemContentName,
          content: DEFAULT_SYSTEM_PROMPT,
        },
      },
    };

    yield {
      chunk: {
        bytes: this.textEncoder.encode(JSON.stringify(systemTextEvent)),
      },
    };

    const systemContentEndEvent = {
      event: {
        contentEnd: {
          promptName: this.promptName,
          contentName: systemContentName,
        },
      },
    };

    yield {
      chunk: {
        bytes: this.textEncoder.encode(JSON.stringify(systemContentEndEvent)),
      },
    };

    console.log(`[Session ${this.sessionId}] system prompt sent`);

    // 4. Send Audio contentStart (MUST be sent before any audio chunks)
    // Based on AWS example: This must be in initial events, not when first audio arrives
    const audioContentStartEvent = {
      event: {
        contentStart: {
          promptName: this.promptName,
          contentName: this.audioContentName,
          type: 'AUDIO',
          interactive: true,
          role: 'USER',
          audioInputConfiguration: DEFAULT_AUDIO_INPUT_CONFIG,
        },
      },
    };

    yield {
      chunk: {
        bytes: this.textEncoder.encode(JSON.stringify(audioContentStartEvent)),
      },
    };
    this.audioContentStarted = true;
    console.log(`[Session ${this.sessionId}] Audio contentStart sent`);

    // 5. Stream audio chunks, tool results, and stop events from queues
    // Based on AWS example: https://github.com/aws-samples/aws-bedrock-examples
    this.isActive = true;
    this.sessionReady = true;
    let sentCount = 0;
    
    // Loop while active - when stop() is called, isActive becomes false
    // and generator will process remaining queue items before ending
    while (this.isActive) {
      // Send tool results first (higher priority)
      if (this.toolResultQueue.length > 0) {
        const toolResult = this.toolResultQueue.shift()!;
        yield {
          chunk: {
            bytes: this.textEncoder.encode(JSON.stringify({ event: toolResult })),
          },
        };
        continue; // Continue to next iteration
      }
      
      // Then send audio chunks or stop events
      if (this.audioQueue.length > 0) {
        const queuedItem = this.audioQueue.shift()!;
        
        // Check if this is a stop event (contentEnd, promptEnd, sessionEnd)
        // or an audio event from addAudioChunk
        if (queuedItem && typeof queuedItem === 'object' && 'event' in queuedItem) {
          // This is an event (audio or stop event)
          const eventType = Object.keys(queuedItem.event)[0];
          yield {
            chunk: {
              bytes: this.textEncoder.encode(JSON.stringify(queuedItem)),
            },
          };
          
          // Log only non-audio events to avoid spam
          if (eventType !== 'audioInput') {
            console.log(`[Session ${this.sessionId}] ${eventType} sent`);
          } else {
            sentCount++;
            if (sentCount % 100 === 0) {
              console.log(`[Session ${this.sessionId}] Sent ${sentCount} audio events, queue: ${this.audioQueue.length}`);
            }
          }
          continue;
        }
      } else {
        // Wait a bit if queue is empty but session is still active
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    
    console.log(`[Session ${this.sessionId}] Event stream ended`);
  }

  /**
   * Add audio chunk to queue
   * Based on AWS example: accepts base64 string directly
   */
  addAudioChunk(base64Audio: string) {
    // Session must be ready before accepting audio
    if (!this.sessionReady) {
      console.warn(`[Session ${this.sessionId}] Session not ready, ignoring audio chunk`);
      return;
    }
    
    // Push audio event to queue (will be sent by generateEventStream)
    this.audioQueue.push({
      event: {
        audioInput: {
          promptName: this.promptName,
          contentName: this.audioContentName,
          content: base64Audio
        }
      }
    });
    
    console.log(`[Session ${this.sessionId}] Audio chunk added to queue. Queue size:`, this.audioQueue.length);
  }

  /**
   * Add tool result to queue
   */
  addToolResult(toolResult: EventPayload) {
    this.toolResultQueue.push(toolResult);
  }

  /**
   * Handle tool use request from Nova Sonic
   */
  async handleToolUse(toolUseId: string, toolName: string, toolInput: Record<string, unknown>) {
    console.log(`[Session ${this.sessionId}] Tool use:`, toolName, toolInput);

    if (toolName === 'query_documents') {
      const inputWithQuery = toolInput as { query?: unknown };
      const query =
        typeof inputWithQuery.query === 'string' ? inputWithQuery.query : '';

      try {
        // Query KB
        const results = await queryKnowledgeBase(query, {
          maxResults: 3,
          docId: this.docId,
        });

        // Format results
        const formattedResults = results
          .map((result, index) => {
            const content = result.content?.text || '';
            const source = result.location?.s3Location?.uri || 'Unknown';
            return `[Result ${index + 1}] (Source: ${source})\n${content.substring(0, 500)}`;
          })
          .join('\n\n');

        return {
          toolResult: {
            toolUseId,
            content: [
              {
                text: formattedResults || 'No relevant information found in documents.',
              },
            ],
          },
        };
      } catch (error) {
        console.error(`[Session ${this.sessionId}] Tool error:`, error);
        return {
          toolResult: {
            toolUseId,
            content: [
              {
                text: 'Error searching documents. Please try again.',
              },
            ],
            status: 'error',
          },
        };
      }
    }

    return {
      toolResult: {
        toolUseId,
        content: [{ text: 'Tool not found' }],
        status: 'error',
      },
    };
  }

  /**
   * Stop the session
   * Based on AWS example: nova-sonic-example/server.js endSession()
   * Immediately set isActive=false, then queue stop events
   */
  async stop() {
    if (!this.isActive) {
      console.log(`[Session ${this.sessionId}] Already stopped`);
      return;
    }
    
    console.log(`[Session ${this.sessionId}] Ending session...`);
    
    // 1. Set isActive to false immediately (stops generator loop)
    this.isActive = false;
    this.sessionReady = false;
    
    // 2. Queue stop events (generator will send these before ending)
    // Audio contentEnd
    this.audioQueue.push({
      event: {
        contentEnd: {
          promptName: this.promptName,
          contentName: this.audioContentName,
        },
      },
    });
    console.log(`[Session ${this.sessionId}] Audio contentEnd queued`);

    // promptEnd
    this.audioQueue.push({
      event: {
        promptEnd: {
          promptName: this.promptName,
        },
      },
    });
    console.log(`[Session ${this.sessionId}] promptEnd queued`);

    // sessionEnd
    this.audioQueue.push({
      event: {
        sessionEnd: {},
      },
    });
    console.log(`[Session ${this.sessionId}] sessionEnd queued`);

    // 3. Clear queues after a brief delay (allow events to be sent)
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.audioQueue.length = 0;
    this.toolResultQueue.length = 0;
    
    console.log(`[Session ${this.sessionId}] Session stopped`);
  }

  /**
   * Check if session is active
   */
  isSessionActive() {
    return this.isActive;
  }
}
