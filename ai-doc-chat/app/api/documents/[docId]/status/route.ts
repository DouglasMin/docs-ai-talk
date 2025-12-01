/**
 * API Route: Get Document Status
 * GET /api/documents/[docId]/status
 * 
 * Checks ingestion job status and updates document accordingly
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDocument, updateDocumentStatus } from '@/lib/services/dynamodb-service';
import { checkIngestionStatus } from '@/lib/services/bedrock-service';
import { Document } from '@/types';

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

    // If already ready or failed, return current status
    if (doc.status === 'ready' || doc.status === 'failed') {
      return NextResponse.json({ status: doc.status });
    }

    // If ingesting, check the ingestion job
    if (doc.status === 'ingesting' && doc.ingestionJobId) {
      try {
        const jobStatus = await checkIngestionStatus(doc.ingestionJobId);
        
        if (jobStatus.status === 'COMPLETE') {
          await updateDocumentStatus(docId, 'ready');
          return NextResponse.json({ status: 'ready' });
        } else if (jobStatus.status === 'FAILED') {
          await updateDocumentStatus(docId, 'failed', 'Ingestion job failed');
          return NextResponse.json({ status: 'failed' });
        }
      } catch (error) {
        console.error('Error checking ingestion status:', error);
        // Don't fail the request, just return current status
      }
    }

    return NextResponse.json({ status: doc.status });
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}
