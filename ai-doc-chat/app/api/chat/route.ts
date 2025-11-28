/**
 * API Route: Chat with RAG
 * POST /api/chat
 * 
 * Handles text-based chat with Nova Pro using RAG
 */

import { NextRequest, NextResponse } from 'next/server';
import { chatWithRAG } from '@/lib/services/bedrock-service';
import type { Message } from '@aws-sdk/client-bedrock-runtime';

export async function POST(request: NextRequest) {
  try {
    const { message, conversationHistory, docId } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get streaming response from Nova Pro
    const response = await chatWithRAG({
      message,
      conversationHistory: conversationHistory as Message[] || [],
      docId: docId || undefined,
    });

    // Create readable stream for client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (response.stream) {
            for await (const chunk of response.stream) {
              if (chunk.contentBlockDelta?.delta?.text) {
                const text = chunk.contentBlockDelta.delta.text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
              }
              
              if (chunk.messageStop) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
                break;
              }
            }
          }
        } catch (error) {
          console.error('Streaming error:', error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
