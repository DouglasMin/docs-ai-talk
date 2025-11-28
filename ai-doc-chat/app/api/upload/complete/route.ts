/**
 * API Route: Complete Upload
 * POST /api/upload/complete
 * 
 * After S3 upload completes:
 * 1. Parse PDF with Upstage
 * 2. Store parsed content in S3
 * 3. Trigger Bedrock KB ingestion
 * 4. Update document status
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseDocumentWithUpstage, formatForBedrockKB } from '@/lib/services/upstage-service';
import { updateDocumentStatus, getDocument } from '@/lib/services/dynamodb-service';
import { uploadParsedContent } from '@/lib/services/s3-service';
import { startIngestion } from '@/lib/services/bedrock-service';

export async function POST(request: NextRequest) {
  let docId: string | undefined;
  
  try {
    const body = await request.json();
    docId = body.docId;
    const s3Url = body.s3Url;

    if (!docId || !s3Url) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get document metadata
    const doc = await getDocument(docId);
    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Update status to parsing
    await updateDocumentStatus(docId, 'parsing');
    console.log(`Starting Upstage parsing for ${docId}...`);

    // Parse with Upstage (synchronous)
    const parseResult = await parseDocumentWithUpstage(s3Url);
    console.log(`Parsed ${docId}: ${parseResult.metadata.pages} pages, ${parseResult.metadata.tables} tables`);

    // Format for Bedrock KB
    const formattedContent = formatForBedrockKB(parseResult.content);

    // Upload parsed content to S3
    console.log(`Uploading parsed content for ${docId}...`);
    await uploadParsedContent(docId, formattedContent);

    // Trigger Bedrock KB ingestion
    console.log(`Starting KB ingestion for ${docId}...`);
    const ingestionJob = await startIngestion(docId);

    // Update status to ingesting
    await updateDocumentStatus(docId, 'ingesting', undefined, ingestionJob.jobId);

    return NextResponse.json({
      success: true,
      docId,
      message: 'Document parsed and ingestion started',
      metadata: parseResult.metadata,
    });
  } catch (error) {
    console.error('Upload completion error:', error);
    
    // Update document status to failed (docId already extracted above)
    if (docId) {
      await updateDocumentStatus(
        docId,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    return NextResponse.json(
      { error: 'Failed to complete upload' },
      { status: 500 }
    );
  }
}
