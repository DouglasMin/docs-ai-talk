/**
 * S3 Service
 * Handles S3 operations including presigned URLs
 */

import { s3Client, config } from '../aws-config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignedUrlResult {
  uploadUrl: string;
  key: string;
  bucket: string;
}

/**
 * Generate presigned URL for direct S3 upload
 * Uploads to /input/raw/ so KB can access the original files
 */
export async function generatePresignedUrl(
  fileName: string,
  fileType: string,
  docId: string
): Promise<PresignedUrlResult> {
  const key = `input/raw/${docId}/${fileName}`;
  
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600, // 1 hour
  });

  return {
    uploadUrl,
    key,
    bucket: config.s3.bucket,
  };
}

/**
 * Upload parsed content to S3 for KB ingestion
 * Uploads to /input/parsed/ for organized storage
 */
export async function uploadParsedContent(
  docId: string,
  content: string
): Promise<string> {
  const key = `input/parsed/${docId}.md`;
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: content,
      ContentType: 'text/markdown',
    })
  );

  return key;
}
