'use client';

import { useState } from 'react';
import { Document } from '@/types';

const DELETE_STEPS = [
  {
    id: 'storage',
    label: 'Remove from S3 storage',
    description: 'Deleting uploaded files from raw and parsed folders',
  },
  {
    id: 'knowledge-base',
    label: 'Sync Bedrock knowledge base',
    description: 'Refreshing knowledge base to remove document traces',
  },
] as const;

type DeleteWorkflowStatus = 'idle' | 'deleting' | 'success' | 'error';

const STATUS_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'parse', label: 'Parse' },
  { id: 'ingest', label: 'KB Sync' },
  { id: 'ready', label: 'Ready' },
] as const;

const STATUS_STEP_INDEX: Record<Document['status'], number> = {
  uploading: 0,
  parsing: 1,
  parsed: 2,
  ingesting: 2,
  ready: 3,
  failed: 0,
};

const STATUS_MESSAGES: Record<Document['status'], string> = {
  uploading: 'Uploading to secure storage...',
  parsing: 'Parsing document with Upstage...',
  parsed: 'Parsed successfully. Waiting to sync with knowledge base...',
  ingesting: 'Syncing with Bedrock knowledge base...',
  ready: 'Ready for chat!',
  failed: 'Processing failed. Try re-uploading.',
};

interface DeleteHistoryEntry {
  id: string;
  name: string;
  status: 'success' | 'error';
  timestamp: Date;
  message?: string;
}

interface ToastMessage {
  id: string;
  type: 'success' | 'error';
  message: string;
}

interface DocumentSidebarProps {
  documents: Document[];
  loading: boolean;
  selectedDoc: string | null;
  deletingDocIds: Set<string>;
  onSelectDoc: (id: string) => void;
  onRefresh: () => void;
  onDeleteDoc: (id: string) => Promise<void>;
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
  deletingDocIds,
  onSelectDoc,
  onRefresh,
  onDeleteDoc,
}: DocumentSidebarProps) {
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<Document | null>(null);
  const [deleteWorkflow, setDeleteWorkflow] = useState<{
    status: DeleteWorkflowStatus;
    completedSteps: number;
    error?: string | null;
  }>({
    status: 'idle',
    completedSteps: 0,
    error: null,
  });
  const [deleteHistory, setDeleteHistory] = useState<DeleteHistoryEntry[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (type: ToastMessage['type'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  };

  const addDeleteHistory = (entry: DeleteHistoryEntry) => {
    setDeleteHistory((prev) => [entry, ...prev].slice(0, 5));
  };

  const openDeleteModal = (doc: Document) => {
    setPendingDeleteDoc(doc);
    setDeleteWorkflow({ status: 'idle', completedSteps: 0, error: null });
  };

  const closeDeleteModal = () => {
    if (deleteWorkflow.status === 'deleting') return;
    setPendingDeleteDoc(null);
    setDeleteWorkflow({ status: 'idle', completedSteps: 0, error: null });
  };

  const confirmDelete = async () => {
    if (!pendingDeleteDoc || deleteWorkflow.status === 'deleting') return;

    setDeleteWorkflow({ status: 'deleting', completedSteps: 0, error: null });
    let stagedStepTimer: ReturnType<typeof setTimeout> | null = null;
    const targetDoc = pendingDeleteDoc;

    if (DELETE_STEPS.length > 1) {
      stagedStepTimer = setTimeout(() => {
        setDeleteWorkflow((prev) => ({
          ...prev,
          completedSteps: Math.min(prev.completedSteps + 1, DELETE_STEPS.length - 1),
        }));
      }, 900);
    }

    try {
      await onDeleteDoc(pendingDeleteDoc.id);
      if (stagedStepTimer) clearTimeout(stagedStepTimer);
      setDeleteWorkflow({
        status: 'success',
        completedSteps: DELETE_STEPS.length,
        error: null,
      });
      addDeleteHistory({
        id: targetDoc.id,
        name: targetDoc.name,
        status: 'success',
        timestamp: new Date(),
      });
      showToast('success', `"${targetDoc.name}" deleted successfully`);
      setTimeout(() => {
        setPendingDeleteDoc(null);
        setDeleteWorkflow({ status: 'idle', completedSteps: 0, error: null });
      }, 1200);
    } catch (error) {
      if (stagedStepTimer) clearTimeout(stagedStepTimer);
      const message = error instanceof Error ? error.message : 'Failed to delete document';
      setDeleteWorkflow((prev) => ({
        ...prev,
        status: 'error',
        error: message,
      }));
      addDeleteHistory({
        id: targetDoc.id,
        name: targetDoc.name,
        status: 'error',
        timestamp: new Date(),
        message,
      });
      showToast('error', `Failed to delete "${targetDoc.name}": ${message}`);
    }
  };

  const renderDeleteModal = () => {
    if (!pendingDeleteDoc) return null;

    const totalSteps = DELETE_STEPS.length;
    const hasInFlight =
      deleteWorkflow.status === 'deleting' &&
      deleteWorkflow.completedSteps < totalSteps;
    const progressValue =
      ((deleteWorkflow.completedSteps + (hasInFlight ? 0.5 : 0)) / totalSteps) * 100;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3
                id="delete-dialog-title"
                className="text-xl font-semibold text-gray-900"
              >
                Delete document
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                “{pendingDeleteDoc.name}” will be removed from storage and your Bedrock
                knowledge base. This action can’t be undone.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={deleteWorkflow.status === 'deleting'}
              className="rounded-full p-1 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 18L18 6M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between text-sm font-medium text-gray-600">
              <span>
                {deleteWorkflow.status === 'success'
                  ? 'Completed'
                  : deleteWorkflow.status === 'error'
                    ? 'Stopped'
                    : 'Progress'}
              </span>
              <span>{Math.round(progressValue)}%</span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
              <div
                className={`
                  h-2 rounded-full transition-all duration-500
                  ${
                    deleteWorkflow.status === 'error'
                      ? 'bg-red-500'
                      : deleteWorkflow.status === 'success'
                        ? 'bg-green-500'
                        : 'bg-blue-600'
                  }
                `}
                style={{ width: `${Math.min(100, progressValue)}%` }}
              ></div>
            </div>
          </div>

          <ul className="mt-6 space-y-3">
            {DELETE_STEPS.map((step, index) => {
              const isComplete = deleteWorkflow.completedSteps > index;
              const isActive =
                !isComplete &&
                deleteWorkflow.status === 'deleting' &&
                deleteWorkflow.completedSteps === index;

              return (
                <li
                  key={step.id}
                  className="flex items-start gap-3 rounded-xl border border-gray-100 p-3"
                >
                  <div
                    className={`
                      flex h-10 w-10 items-center justify-center rounded-full
                      ${
                        deleteWorkflow.status === 'error' && isActive
                          ? 'bg-red-100 text-red-600'
                          : isComplete
                            ? 'bg-green-100 text-green-700'
                            : isActive
                              ? 'bg-blue-100 text-blue-600'
                              : 'bg-gray-100 text-gray-500'
                      }
                    `}
                  >
                    {isComplete ? (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M5 13l4 4L19 7"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : isActive ? (
                      <span className="flex h-4 w-4 items-center justify-center">
                        <span className="h-2 w-2 rounded-full bg-current" />
                      </span>
                    ) : (
                      index + 1
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{step.label}</p>
                    <p className="text-xs text-gray-500">{step.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          {deleteWorkflow.error && (
            <p className="mt-4 text-sm text-red-600">{deleteWorkflow.error}</p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={deleteWorkflow.status === 'deleting'}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={
                deleteWorkflow.status === 'deleting' ||
                deleteWorkflow.status === 'success'
              }
              className={`
                inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white
                ${
                  deleteWorkflow.status === 'error'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }
                disabled:cursor-not-allowed disabled:opacity-50
              `}
            >
              {deleteWorkflow.status === 'deleting' && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {deleteWorkflow.status === 'error'
                ? 'Try again'
                : deleteWorkflow.status === 'success'
                  ? 'Completed'
                  : 'Delete document'}
            </button>
          </div>
        </div>
      </div>
    );
  };

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
            {documents.map((doc) => {
              const isDeleting = deletingDocIds.has(doc.id);
              const isPendingDelete = pendingDeleteDoc?.id === doc.id;
              const cardClasses = `
                w-full text-left p-3 rounded-lg transition-colors border relative
                ${selectedDoc === doc.id ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50 border-transparent'}
                ${isDeleting || isPendingDelete ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
              `;

              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => !isDeleting && onSelectDoc(doc.id)}
                  onKeyDown={(e) => {
                    if (!isDeleting && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelectDoc(doc.id);
                    }
                  }}
                  className={cardClasses}
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {doc.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteModal(doc);
                      }}
                      disabled={isDeleting}
                      className="p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Delete document"
                    >
                      {isDeleting ? (
                        <svg
                          className="w-4 h-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                          ></path>
                        </svg>
                      ) : (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M6 7h12M10 11v6M14 11v6M9 7l.867-2.6A1 1 0 0110.816 4h2.368a1 1 0 01.949.4L15 7m-9 0v12a2 2 0 002 2h6a2 2 0 002-2V7"
                          />
                        </svg>
                      )}
                    </button>
                  </div>

                  <span
                    className={`
                      inline-flex items-center px-2 py-1 rounded text-xs font-medium
                      ${isPendingDelete ? 'bg-red-100 text-red-700' : getStatusColor(doc.status)}
                    `}
                  >
                    {isPendingDelete
                      ? 'Awaiting confirmation...'
                      : isDeleting
                        ? 'Deleting...'
                        : getStatusText(doc.status)}
                  </span>
                  <div className="mt-2 text-xs text-gray-500">
                    {STATUS_MESSAGES[doc.status] || 'Processing...'}
                  </div>
                  {doc.status !== 'ready' && doc.status !== 'failed' && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 text-[11px] text-gray-500">
                        {STATUS_STEPS.map((step, index) => {
                          const currentIndex = STATUS_STEP_INDEX[doc.status] ?? 0;
                          const isComplete = index < currentIndex;
                          const isActive = index === currentIndex;
                          return (
                            <div key={step.id} className="flex items-center gap-2">
                              <div
                                className={`
                                  h-2 w-2 rounded-full
                                  ${
                                    isComplete
                                      ? 'bg-green-500'
                                      : isActive
                                        ? 'bg-blue-500 animate-pulse'
                                        : 'bg-gray-300'
                                  }
                                `}
                              ></div>
                              <span className={isActive ? 'text-gray-900 font-semibold' : ''}>
                                {step.label}
                              </span>
                              {index < STATUS_STEPS.length - 1 && (
                                <div className="h-px w-4 bg-gray-200"></div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <div className="text-xs text-gray-500 text-center">
          {documents.length} {documents.length === 1 ? 'document' : 'documents'}
        </div>
        {deleteHistory.length > 0 && (
          <div className="mt-3 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Recent deletions
            </p>
            <ul className="mt-2 space-y-1.5">
              {deleteHistory.map((entry) => (
                <li
                  key={`${entry.id}-${entry.timestamp.getTime()}`}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-2 py-1.5 text-xs"
                >
                  <div className="flex-1 pr-2">
                    <p className="font-medium text-gray-800 truncate">{entry.name}</p>
                    <p className="text-[11px] text-gray-500">
                      {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      entry.status === 'success'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    {entry.status === 'success' ? 'Deleted' : 'Failed'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {renderDeleteModal()}

      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[70] space-y-3">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`
                flex items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ring-black/5
                ${toast.type === 'success' ? 'bg-white text-gray-900' : 'bg-red-600 text-white'}
              `}
            >
              <span className="mt-0.5">
                {toast.type === 'success' ? (
                  <svg className="h-4 w-4 text-green-500" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <div className="flex-1 text-left">{toast.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
