/**
 * useIngestionStatus Hook
 * Polls ingestion status for documents
 */

import { useState, useEffect } from 'react';

interface IngestionStatus {
  status: 'ingesting' | 'ready' | 'failed' | string;
  error?: string;
}

export function useIngestionStatus(docId: string | null, enabled: boolean = true) {
  const [status, setStatus] = useState<IngestionStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    if (!docId || !enabled) return;

    let intervalId: NodeJS.Timeout;
    let isMounted = true;

    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/documents/${docId}/ingestion-status`);
        if (!response.ok) {
          throw new Error('Failed to check status');
        }

        const data = await response.json();
        
        if (isMounted) {
          setStatus(data);

          // Stop polling if ingestion is complete or failed
          if (data.status === 'ready' || data.status === 'failed') {
            setIsPolling(false);
            if (intervalId) clearInterval(intervalId);
          }
        }
      } catch (error) {
        console.error('Error checking ingestion status:', error);
        if (isMounted) {
          setIsPolling(false);
        }
      }
    };

    // Start polling
    setIsPolling(true);
    checkStatus(); // Check immediately

    // Poll every 5 seconds
    intervalId = setInterval(checkStatus, 5000);

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [docId, enabled]);

  return { status, isPolling };
}
