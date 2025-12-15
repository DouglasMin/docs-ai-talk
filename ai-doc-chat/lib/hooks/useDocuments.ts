/**
 * useDocuments Hook
 * Fetch and manage document list
 */

import { useState, useEffect } from 'react';
import { Document } from '@/types';

export function useDocuments() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/documents');
      
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching documents:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshDocuments = () => {
    fetchDocuments();
  };

  const addDocument = (doc: Document) => {
    setDocuments((prev) => [doc, ...prev]);
  };

  const updateDocument = (id: string, updates: Partial<Document>) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc))
    );
  };

  const removeDocument = (id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  };

  const deleteDocument = async (id: string) => {
    setDeletingDocIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        let message = 'Failed to delete document';
        try {
          const data = await response.json();
          message = data.error || message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      removeDocument(id);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete document';
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setDeletingDocIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  return {
    documents,
    loading,
    error,
    refreshDocuments,
    addDocument,
    updateDocument,
    deleteDocument,
    removeDocument,
    deletingDocIds,
  };
}
