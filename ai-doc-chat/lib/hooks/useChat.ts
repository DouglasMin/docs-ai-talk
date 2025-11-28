/**
 * useChat Hook
 * Handles chat functionality with streaming responses
 */

import { useState, useCallback } from 'react';
import type { Message } from '@aws-sdk/client-bedrock-runtime';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UseChatOptions {
  onError?: (error: string) => void;
  selectedDoc?: string | null;
}

export function useChat(options: UseChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>('');

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingMessage('');

    try {
      // Convert to Bedrock message format
      const conversationHistory: Message[] = messages.map(msg => ({
        role: msg.role,
        content: [{ text: msg.content }]
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          conversationHistory,
          docId: options.selectedDoc || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response stream');
      }

      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.text) {
                assistantContent += data.text;
                setStreamingMessage(assistantContent);
              }
              
              if (data.done) {
                const assistantMessage: ChatMessage = {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: assistantContent,
                  timestamp: new Date(),
                };
                
                setMessages(prev => [...prev, assistantMessage]);
                setStreamingMessage('');
                return;
              }
              
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (parseError) {
              // Ignore JSON parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      options.onError?.(errorMessage);
      
      // Add error message to chat
      const errorChatMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorChatMessage]);
    } finally {
      setIsLoading(false);
      setStreamingMessage('');
    }
  }, [messages, isLoading, options]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setStreamingMessage('');
  }, []);

  return {
    messages,
    streamingMessage,
    isLoading,
    sendMessage,
    clearChat,
  };
}
