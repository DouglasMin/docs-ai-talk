/**
 * Type definitions for the AI Document Chat application
 */

export type ContentType = 'text' | 'image' | 'table' | 'chart' | 'diagram';

export type DocumentStatus = 
  | 'uploading' 
  | 'parsing' 
  | 'ingesting' 
  | 'ready' 
  | 'failed';

export interface Document {
  id: string;
  name: string;
  s3Key: string;
  parsedS3Key?: string;
  status: DocumentStatus;
  pageCount?: number;
  fileSize: number;
  contentTypes: ContentType[];
  uploadedAt: Date;
  processedAt?: Date;
  error?: string;
  ingestionJobId?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  mode: 'text' | 'voice';
  sources?: Source[];
  timestamp: Date;
}

export interface Source {
  docId: string;
  pageNumber?: number;
  contentType: ContentType;
  excerpt: string;
}

export interface IngestionJob {
  jobId: string;
  docId: string;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface UploadResult {
  docId: string;
  fileName: string;
  status: 'processing' | 'failed';
  s3Key: string;
  metadata?: {
    pages: number;
    tables: number;
    charts: number;
  };
}

export interface RetrievalResult {
  content: string;
  metadata: {
    source: string;
    page?: number;
    contentType?: ContentType;
  };
  score: number;
}
