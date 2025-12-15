/**
 * API Route: Delete Document
 * DELETE /api/documents/[docId]
 *
 * Removes document metadata, S3 artifacts, and triggers a KB sync so the
 * deleted content disappears from Bedrock knowledge base results.
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getDocument, 
  deleteDocument as deleteDocumentRecord 
} from '@/lib/services/dynamodb-service';
import { deleteObjectByKey, deleteObjectsByPrefix } from '@/lib/services/s3-service';
import { startIngestion } from '@/lib/services/bedrock-service';

type RouteParams = { docId: string };

export async function DELETE(
  _request: NextRequest,
  { params }: { params: RouteParams | Promise<RouteParams> }
) {
  try {
    const { docId } = await Promise.resolve(params);

    if (!docId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 }
      );
    }

    const doc = await getDocument(docId);
    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    const parsedKey = `input/parsed/${docId}.md`;
    const rawPrefix = `input/raw/${docId}/`;

    // Delete original upload(s) and parsed artifact
    await Promise.all([
      deleteObjectsByPrefix(rawPrefix),
      deleteObjectByKey(parsedKey),
      deleteObjectByKey(doc.s3Key),
    ]);

    // Re-run KB ingestion to propagate the deletion. We start this before
    // removing the metadata so the caller can retry if KB sync fails.
    const ingestionJob = await startIngestion(docId);

    // Remove metadata so it disappears from the UI
    await deleteDocumentRecord(docId);

    return NextResponse.json({
      success: true,
      ingestionJobId: ingestionJob.jobId,
    });
  } catch (error) {
    console.error('Delete document error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete document';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
