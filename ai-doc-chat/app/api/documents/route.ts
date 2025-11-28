/**
 * API Route: List Documents
 * GET /api/documents
 */

import { NextResponse } from 'next/server';
import { listDocuments } from '@/lib/services/dynamodb-service';

export async function GET() {
  try {
    const documents = await listDocuments();
    
    return NextResponse.json({
      documents,
      count: documents.length,
    });
  } catch (error) {
    console.error('List documents error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}
