/**
 * API Route: Check Ingestion Status
 * GET /api/documents/[docId]/ingestion-status
 * 
 * Polls Bedrock KB ingestion job status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDocument, updateDocumentStatus } from '@/lib/services/dynamodb-service';
import { checkIngestionStatus } from '@/lib/services/bedrock-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const { docId } = await params;

    // Get document from DB
    const doc = await getDocument(docId);
    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // If not ingesting or no job ID, return current status
    if (doc.status !== 'ingesting' || !(doc as any).ingestionJobId) {
      return NextResponse.json({ status: doc.status });
    }

    // Check ingestion job status
    const jobStatus = await checkIngestionStatus((doc as any).ingestionJobId);

    // Map Bedrock status to our status
    if (jobStatus.status === 'COMPLETE') {
      await updateDocumentStatus(docId, 'ready');
      return NextResponse.json({ status: 'ready' });
    } else if (jobStatus.status === 'FAILED') {
      const errorMessage = jobStatus.failureReasons?.join(', ') || 'Ingestion failed';
      await updateDocumentStatus(docId, 'failed', errorMessage);
      return NextResponse.json({ 
        status: 'failed', 
        error: errorMessage 
      });
    } else {
      // Still in progress (STARTING, IN_PROGRESS)
      return NextResponse.json({ status: 'ingesting' });
    }
  } catch (error) {
    console.error('Ingestion status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check ingestion status' },
      { status: 500 }
    );
  }
}
