/**
 * S3 Service
 * Handles S3 operations including presigned URLs
 */

import { s3Client, config } from '../aws-config';
import { 
  DeleteObjectCommand, 
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand 
} from '@aws-sdk/client-s3';
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

/**
 * Delete an object from S3. Safe to call even if the object is missing.
 */
export async function deleteObjectByKey(key: string): Promise<void> {
  if (!key) return;

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    })
  );
}

/**
 * Delete all objects under a prefix (e.g., remove folder contents)
 */
export async function deleteObjectsByPrefix(prefix: string): Promise<void> {
  if (!prefix) return;

  let continuationToken: string | undefined;

  do {
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const objects = listResponse.Contents ?? [];
    if (objects.length > 0) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: config.s3.bucket,
          Delete: {
            Objects: objects.map((obj) => ({ Key: obj.Key! })),
            Quiet: true,
          },
        })
      );
    }

    continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
  } while (continuationToken);
}
