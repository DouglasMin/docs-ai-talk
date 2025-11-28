'use client';

import { useState } from 'react';

interface EmptyStateProps {
  onUploadComplete: (doc: any) => void;
}

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'parsing' | 'ingesting' | 'complete' | 'error';
  error?: string;
}

export default function EmptyState({ onUploadComplete }: EmptyStateProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    
    if (pdfFiles.length > 0) {
      await handleFiles(pdfFiles);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('File selected!', e.target.files);
    const files = e.target.files;
    if (files && files.length > 0) {
      console.log('Starting upload for', files.length, 'files');
      await handleFiles(Array.from(files));
    }
  };

  const handleFiles = async (files: File[]) => {
    console.log('handleFiles called with', files);
    for (const file of files) {
      console.log('Processing file:', file.name);
      const uploadId = Date.now().toString();
      
      // Add to uploads list
      setUploads(prev => {
        console.log('Adding to uploads:', file.name);
        return [...prev, {
          fileName: file.name,
          progress: 0,
          status: 'uploading',
        }];
      });

      try {
        // Get presigned URL
        const response = await fetch('/api/upload/presigned-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
          }),
        });

        if (!response.ok) throw new Error('Failed to get upload URL');

        const { docId, uploadUrl } = await response.json();

        // Upload to S3 with progress
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const progress = Math.round((e.loaded / e.total) * 100);
              setUploads(prev => prev.map(u => 
                u.fileName === file.name ? { ...u, progress } : u
              ));
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          });

          xhr.addEventListener('error', () => reject(new Error('Upload failed')));

          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.send(file);
        });

        // Update to parsing
        setUploads(prev => prev.map(u => 
          u.fileName === file.name ? { ...u, status: 'parsing', progress: 100 } : u
        ));

        // Complete upload
        const s3Url = uploadUrl.split('?')[0];
        await fetch('/api/upload/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId, s3Url }),
        });

        // Update to complete
        setUploads(prev => prev.map(u => 
          u.fileName === file.name ? { ...u, status: 'complete' } : u
        ));

        // Notify parent
        onUploadComplete({ id: docId, name: file.name });

        // Remove from list after 2 seconds
        setTimeout(() => {
          setUploads(prev => prev.filter(u => u.fileName !== file.name));
        }, 2000);

      } catch (error) {
        console.error('Upload failed:', error);
        setUploads(prev => prev.map(u => 
          u.fileName === file.name 
            ? { ...u, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' } 
            : u
        ));
      }
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        {/* Icon */}
        <div className="mb-8">
          <svg
            className="mx-auto h-24 w-24 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Welcome to AI Document Chat
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Upload your PDF documents to start asking questions and get instant answers powered by AI
        </p>

        {/* Upload Area */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative border-2 border-dashed rounded-lg p-12 transition-colors
            ${isDragging 
              ? 'border-blue-500 bg-blue-50' 
              : 'border-gray-300 hover:border-gray-400'
            }
          `}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
          />
          
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center"
          >
            <svg
              className="h-12 w-12 text-gray-400 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            
            <span className="text-lg font-medium text-gray-700 mb-2">
              Drop your PDF files here, or click to browse
            </span>
            <span className="text-sm text-gray-500">
              Supports multiple files • Max 100MB per file
            </span>
          </label>
        </div>

        {/* Upload Progress */}
        {uploads.length > 0 && (
          <div className="mt-8 space-y-3">
            {uploads.map((upload) => (
              <div key={upload.fileName} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900 truncate flex-1">
                    {upload.fileName}
                  </span>
                  <span className="text-xs text-gray-500 ml-2">
                    {upload.status === 'uploading' && `${upload.progress}%`}
                    {upload.status === 'parsing' && '파싱 중...'}
                    {upload.status === 'ingesting' && '인덱싱 중...'}
                    {upload.status === 'complete' && '완료!'}
                    {upload.status === 'error' && '실패'}
                  </span>
                </div>
                
                {upload.status !== 'error' && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        upload.status === 'complete' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                )}
                
                {upload.error && (
                  <p className="text-xs text-red-600 mt-1">{upload.error}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Features */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Smart Parsing</h3>
              <p className="text-sm text-gray-600">Extracts text, tables, and charts automatically</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Text & Voice Chat</h3>
              <p className="text-sm text-gray-600">Ask questions via text or voice</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Instant Answers</h3>
              <p className="text-sm text-gray-600">Get accurate responses in seconds</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
