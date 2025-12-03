/**
 * API Route: Complete Upload (Async)
 * POST /api/upload/complete
 * 
 * After S3 upload completes:
 * 1. Validate docId and s3Url
 * 2. Send message to SQS for async processing
 * 3. Return immediately with 'accepted' status
 * 
 * The actual processing (parse → upload → ingest) happens in a worker.
 * Client should poll /api/documents/[docId]/status for updates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDocument } from '@/lib/services/dynamodb-service';
import { sendIngestionMessage } from '@/lib/services/sqs-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { docId, s3Url } = body;

    // Validate required fields
    if (!docId || !s3Url) {
      return NextResponse.json(
        { error: 'Missing required fields: docId and s3Url' },
        { status: 400 }
      );
    }

    // Verify document exists
    const doc = await getDocument(docId);
    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Send message to SQS for async processing
    const messageId = await sendIngestionMessage({
      docId,
      s3Url,
      fileName: doc.name,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Upload Complete] Queued document ${docId} for processing (MessageId: ${messageId})`);

    // Return immediately - client should poll for status
    return NextResponse.json({
      accepted: true,
      docId,
      messageId,
      message: 'Document queued for processing. Poll /api/documents/[docId]/status for updates.',
    });

  } catch (error) {
    console.error('[Upload Complete] Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to queue document for processing',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
