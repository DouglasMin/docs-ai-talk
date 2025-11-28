/**
 * API Route: Generate Presigned URL
 * POST /api/upload/presigned-url
 */

import { NextRequest, NextResponse } from 'next/server';
import { generatePresignedUrl } from '@/lib/services/s3-service';
import { createDocument } from '@/lib/services/dynamodb-service';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const { fileName, fileType, fileSize } = await request.json();

    // Validate input
    if (!fileName || !fileType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (fileType !== 'application/pdf') {
      return NextResponse.json(
        { error: 'Only PDF files are supported' },
        { status: 400 }
      );
    }

    if (fileSize > 100 * 1024 * 1024) { // 100MB
      return NextResponse.json(
        { error: 'File size exceeds 100MB limit' },
        { status: 400 }
      );
    }

    // Generate document ID
    const docId = uuidv4();

    // Generate presigned URL
    const { uploadUrl, key } = await generatePresignedUrl(
      fileName,
      fileType,
      docId
    );

    // Create document metadata in DynamoDB
    await createDocument({
      id: docId,
      name: fileName,
      s3Key: key,
      status: 'uploading',
      fileSize,
      contentTypes: [],
    });

    return NextResponse.json({
      docId,
      uploadUrl,
      key,
    });
  } catch (error) {
    console.error('Presigned URL generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 }
    );
  }
}
