'use client';

import { useState } from 'react';
import { Document } from '@/types';

interface DocumentSidebarProps {
  documents: Document[];
  loading: boolean;
  selectedDoc: string | null;
  onSelectDoc: (id: string) => void;
  onRefresh: () => void;
}

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'parsing' | 'complete' | 'error';
}

export default function DocumentSidebar({
  documents,
  loading,
  selectedDoc,
  onSelectDoc,
  onRefresh,
}: DocumentSidebarProps) {
  const [uploads, setUploads] = useState<UploadProgress[]>([]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await handleFiles(Array.from(files));
    }
  };

  const handleFiles = async (files: File[]) => {
    for (const file of files) {
      setUploads(prev => [...prev, {
        fileName: file.name,
        progress: 0,
        status: 'uploading',
      }]);

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
            if (xhr.status === 200) resolve();
            else reject(new Error(`Upload failed with status ${xhr.status}`));
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

        // Refresh document list
        onRefresh();

        // Remove from list after 2 seconds
        setTimeout(() => {
          setUploads(prev => prev.filter(u => u.fileName !== file.name));
        }, 2000);

      } catch (error) {
        console.error('Upload failed:', error);
        setUploads(prev => prev.map(u => 
          u.fileName === file.name ? { ...u, status: 'error' } : u
        ));
      }
    }
  };

  const getStatusColor = (status: Document['status']) => {
    switch (status) {
      case 'ready':
        return 'bg-green-100 text-green-800';
      case 'uploading':
      case 'parsing':
      case 'ingesting':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: Document['status']) => {
    switch (status) {
      case 'ready':
        return 'Ready';
      case 'uploading':
        return 'Uploading...';
      case 'parsing':
        return 'Parsing...';
      case 'ingesting':
        return 'Ingesting...';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
          <button
            onClick={onRefresh}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh documents"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        
        {/* Upload Button */}
        <label
          htmlFor="sidebar-file-upload"
          className="flex items-center justify-center w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors"
        >
          <svg
            className="w-5 h-5 mr-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Upload PDF
        </label>
        <input
          type="file"
          id="sidebar-file-upload"
          className="hidden"
          accept=".pdf"
          multiple
          onChange={handleFileSelect}
        />
      </div>

      {/* Upload Progress */}
      {uploads.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-200">
          <div className="space-y-2">
            {uploads.map((upload) => (
              <div key={upload.fileName} className="bg-gray-50 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700 truncate flex-1">
                    {upload.fileName}
                  </span>
                  <span className="text-xs text-gray-500 ml-2">
                    {upload.status === 'uploading' && `${upload.progress}%`}
                    {upload.status === 'parsing' && '파싱 중...'}
                    {upload.status === 'complete' && '완료!'}
                    {upload.status === 'error' && '실패'}
                  </span>
                </div>
                
                {upload.status !== 'error' && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        upload.status === 'complete' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-sm text-gray-500 mt-2">Loading documents...</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No documents uploaded yet
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => onSelectDoc(doc.id)}
                className={`
                  w-full text-left p-3 rounded-lg transition-colors
                  ${selectedDoc === doc.id
                    ? 'bg-blue-50 border-blue-200 border'
                    : 'hover:bg-gray-50 border border-transparent'
                  }
                `}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {doc.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(doc.uploadedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <span
                  className={`
                    inline-flex items-center px-2 py-1 rounded text-xs font-medium
                    ${getStatusColor(doc.status)}
                  `}
                >
                  {getStatusText(doc.status)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <div className="text-xs text-gray-500 text-center">
          {documents.length} {documents.length === 1 ? 'document' : 'documents'}
        </div>
      </div>
    </div>
  );
}
