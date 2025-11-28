/**
 * Nova Sonic WebSocket Server
 * Handles voice chat sessions
 */

import { WebSocket } from 'ws';
import { NovaClient } from './client';
import { NovaSession } from './session';

export function handleVoiceConnection(ws: WebSocket, sessionId: string) {
  console.log(`🎤 [${sessionId}] Voice session started`);

  let session: NovaSession | null = null;
  let client: NovaClient | null = null;

  ws.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // Start session
      if (message.type === 'start') {
        const { voiceId, docId } = message;
        
        session = new NovaSession(sessionId, { voiceId, docId });
        client = new NovaClient();

        // Start streaming
        client
          .startStream(
            session,
            // onAudioChunk
            (audioData) => {
              ws.send(
                JSON.stringify({
                  type: 'audio',
                  data: Buffer.from(audioData).toString('base64'),
                })
              );
            },
            // onText
            (text) => {
              ws.send(
                JSON.stringify({
                  type: 'text',
                  text,
                })
              );
            },
            // onToolUse
            async (toolUseId, toolName, toolInput) => {
              const toolResult = await session!.handleToolUse(
                toolUseId,
                toolName,
                toolInput
              );
              
              // Add tool result to session queue (will be sent back through input stream)
              session!.addToolResult(toolResult);
              console.log(`[${sessionId}] Tool result added to queue`);
            },
            // onContentEnd
            (stopReason) => {
              ws.send(
                JSON.stringify({
                  type: 'contentEnd',
                  stopReason,
                })
              );
            }
          )
          .catch((error) => {
            console.error(`❌ [${sessionId}] Streaming error:`, error);
            ws.send(
              JSON.stringify({
                type: 'error',
                error: error.message,
              })
            );
          });

        ws.send(JSON.stringify({ type: 'ready' }));
      }

      // Audio chunk from client
      else if (message.type === 'audio' && session) {
        // Client sends { type: 'audio', audio: base64 }
        // Pass base64 string directly to session (like AWS example)
        const base64Audio = message.audio;
        console.log(`[${sessionId}] Received audio chunk:`, base64Audio.length, 'chars');
        session.addAudioChunk(base64Audio);
      }

      // Stop session
      else if (message.type === 'stop' && session) {
        await session.stop();
        ws.send(JSON.stringify({ type: 'stopped' }));
      }
    } catch (error) {
      console.error(`❌ [${sessionId}] Message error:`, error);
      ws.send(
        JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    }
  });

  ws.on('close', () => {
    if (session) {
      console.log(`🔌 [${sessionId}] WebSocket closed, stopping session`);
      session.stop();
      session = null;
    } else {
      console.log(`👋 [${sessionId}] Voice session already ended`);
    }
  });

  ws.on('error', (error: Error) => {
    console.error(`❌ [${sessionId}] WebSocket error:`, error);
  });
}
