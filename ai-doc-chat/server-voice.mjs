/**
 * Custom WebSocket Server for Nova Sonic Voice Chat
 * Run with: node server-voice.mjs
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Import Nova Sonic voice server after Next.js is ready
  const { handleVoiceConnection } = await import('./lib/voice/server.ts');

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // WebSocket server for voice chat
  const voiceWss = new WebSocketServer({ 
    server, 
    path: '/api/voice-ws',
    // Don't handle upgrade for HMR - let Next.js handle it
    verifyClient: (info) => {
      return info.req.url === '/api/voice-ws';
    }
  });

  voiceWss.on('connection', (ws) => {
    const sessionId = randomUUID();
    handleVoiceConnection(ws, sessionId);
  });
  
  // Note: Next.js HMR WebSocket (_next/webpack-hmr) is handled by Next.js itself
  // The connection failure warning is expected and can be ignored

  server.listen(port, (err) => {
    if (err) throw err;
    console.log('🎤 Nova Sonic Voice Server');
    console.log('==========================');
    console.log(`🚀 Server: http://${hostname}:${port}`);
    console.log(`🔌 WebSocket: ws://${hostname}:${port}/api/voice-ws`);
  });
});
