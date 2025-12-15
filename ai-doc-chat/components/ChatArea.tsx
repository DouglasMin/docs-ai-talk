'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@/lib/hooks/useChat';
import { useVoiceChat, type VoiceMessage } from '@/lib/hooks/useVoiceChat';

interface ChatAreaProps {
  selectedDoc: string | null;
}

type CombinedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isVoice?: boolean;
};

const isVoiceMessage = (message: CombinedMessage): message is VoiceMessage =>
  (message as VoiceMessage).isVoice === true;

export default function ChatArea({ selectedDoc }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { messages, streamingMessage, isLoading, sendMessage } = useChat({
    onError: (error) => {
      console.error('Chat error:', error);
    },
    selectedDoc,
  });

  const { isRecording, isConnected, transcript, voiceMessages, startVoice, stopVoice } = useVoiceChat({
    selectedDoc,
    onError: (error) => {
      console.error('Voice error:', error);
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Combine text and voice messages, sorted by timestamp
  const allMessages: CombinedMessage[] = [...messages, ...voiceMessages].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  if (streamingMessage) {
    allMessages.push({
      id: 'streaming',
      role: 'assistant' as const,
      content: streamingMessage,
      timestamp: new Date(),
    });
  }

  return (
    <div className="flex-1 flex flex-col bg-white h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 p-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {selectedDoc ? 'Chat with Document' : 'Chat with All Documents'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Ask questions about your uploaded documents
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setMode('text')}
            className={`
              px-4 py-2 rounded-md text-sm font-medium transition-colors
              ${mode === 'text'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
              }
            `}
          >
            <svg className="w-5 h-5 inline mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            Text
          </button>
          <button
            onClick={() => setMode('voice')}
            className={`
              px-4 py-2 rounded-md text-sm font-medium transition-colors
              ${mode === 'voice'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
              }
            `}
          >
            <svg className="w-5 h-5 inline mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Voice
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {allMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <svg
                className="mx-auto h-12 w-12 text-gray-300 mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Start a conversation
              </h3>
              <p className="text-sm text-gray-500">
                Ask questions about your documents and get instant AI-powered answers
              </p>
            </div>
          </div>
        ) : (
          <>
            {allMessages.map((message) => {
              const voiceMessage = isVoiceMessage(message);
              return (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`
                      max-w-[85%] max-h-[600px] overflow-y-auto rounded-lg px-4 py-3 break-words
                      ${message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                      }
                    `}
                  >
                    <div className="flex items-start space-x-2">
                      {voiceMessage && (
                        <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                        </svg>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words flex-1">{message.content}</p>
                    </div>
                    {message.id !== 'streaming' && (
                      <p
                        className={`text-xs mt-2 ${
                          message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                        }`}
                      >
                        {message.timestamp.toLocaleTimeString()}
                      </p>
                    )}
                    {message.id === 'streaming' && (
                      <div className="flex items-center space-x-2 mt-2">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4 flex-shrink-0">
        {mode === 'text' ? (
          <div className="flex items-end space-x-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your documents..."
              disabled={isLoading}
              className="flex-1 resize-none rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              rows={3}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <button
              onClick={isRecording ? stopVoice : startVoice}
              className={`flex items-center space-x-3 px-8 py-4 rounded-full transition-colors ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
              <span className="font-medium">
                {isRecording ? 'Stop Recording' : 'Start Voice Chat'}
              </span>
            </button>
            
            {isConnected && (
              <div className="text-sm text-gray-600">
                {isRecording ? '🎤 Listening...' : '🔌 Connected'}
              </div>
            )}
            
            {transcript && (
              <div className="max-w-md p-4 bg-gray-100 rounded-lg">
                <p className="text-sm text-gray-700">{transcript}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
