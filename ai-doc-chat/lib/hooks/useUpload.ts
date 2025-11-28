/**
 * useUpload Hook
 * Reusable upload logic with progress tracking
 */

import { useState } from 'react';

interface UploadProgress {
  docId: string;
  fileName: string;
  progress: number;
  status: 'uploading' | 'parsing' | 'ingesting' | 'complete' | 'error';
  error?: string;
}

export function useUpload() {
  const [uploads, setUploads] = useState<Map<string, UploadProgress>>(new Map());

  const uploadFile = async (file: File) => {
    try {
      // Step 1: Get presigned URL
      const presignedResponse = await fetch('/api/upload/presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        }),
      });

      if (!presignedResponse.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { docId, uploadUrl, key } = await presignedResponse.json();

      // Initialize progress
      setUploads((prev) => new Map(prev).set(docId, {
        docId,
        fileName: file.name,
        progress: 0,
        status: 'uploading',
      }));

      // Step 2: Upload to S3 with progress tracking
      await uploadToS3(file, uploadUrl, (progress) => {
        setUploads((prev) => {
          const updated = new Map(prev);
          const current = updated.get(docId);
          if (current) {
            updated.set(docId, { ...current, progress });
          }
          return updated;
        });
      });

      // Step 3: Complete upload (parse & ingest) - now synchronous
      setUploads((prev) => {
        const updated = new Map(prev);
        const current = updated.get(docId);
        if (current) {
          updated.set(docId, { ...current, status: 'parsing', progress: 100 });
        }
        return updated;
      });

      const s3Url = uploadUrl.split('?')[0]; // Remove query params
      const completeResponse = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, s3Url }),
      });

      if (!completeResponse.ok) {
        throw new Error('Failed to complete upload');
      }

      const completeData = await completeResponse.json();

      // Mark as ingesting (parsing is done, now ingesting to KB)
      setUploads((prev) => {
        const updated = new Map(prev);
        const current = updated.get(docId);
        if (current) {
          updated.set(docId, { ...current, status: 'ingesting' });
        }
        return updated;
      });

      return docId;
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  };

  const uploadToS3 = async (
    file: File,
    uploadUrl: string,
    onProgress: (progress: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);
    });
  };

  return {
    uploads: Array.from(uploads.values()),
    uploadFile,
  };
}
