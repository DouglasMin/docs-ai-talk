'use client';

import { useState, useEffect } from 'react';
import DocumentSidebar from '@/components/DocumentSidebar';
import ChatArea from '@/components/ChatArea';
import EmptyState from '@/components/EmptyState';
import { useDocuments } from '@/lib/hooks/useDocuments';
import { Document } from '@/types';

export default function Home() {
  const { documents, loading, refreshDocuments, addDocument } = useDocuments();
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);

  // Poll status for documents that are processing (every 10 seconds)
  useEffect(() => {
    const processingDocs = documents.filter(
      (doc) => doc.status === 'parsing' || doc.status === 'ingesting'
    );

    if (processingDocs.length === 0) return;

    const interval = setInterval(async () => {
      let hasChanges = false;
      
      for (const doc of processingDocs) {
        try {
          // Check parse status for parsing docs
          if (doc.status === 'parsing') {
            const response = await fetch(`/api/documents/${doc.id}/parse-status`);
            if (response.ok) {
              const data = await response.json();
              if (data.status !== 'parsing') {
                hasChanges = true;
              }
            }
          }
          // Check ingestion status for ingesting docs
          else if (doc.status === 'ingesting') {
            const response = await fetch(`/api/documents/${doc.id}/status`);
            if (response.ok) {
              const data = await response.json();
              if (data.status === 'ready' || data.status === 'failed') {
                hasChanges = true;
              }
            }
          }
        } catch (error) {
          console.error('Error polling status:', error);
        }
      }
      
      // Only refresh if something changed
      if (hasChanges) {
        refreshDocuments();
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [documents, refreshDocuments]);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Document Sidebar */}
      <DocumentSidebar 
        documents={documents}
        loading={loading}
        selectedDoc={selectedDoc}
        onSelectDoc={setSelectedDoc}
        onRefresh={refreshDocuments}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {documents.length === 0 && !loading ? (
          <EmptyState onUploadComplete={(doc) => {
            addDocument(doc);
            refreshDocuments();
          }} />
        ) : (
          <ChatArea selectedDoc={selectedDoc} />
        )}
      </div>
    </div>
  );
}
