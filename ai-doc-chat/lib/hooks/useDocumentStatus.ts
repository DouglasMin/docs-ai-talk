/**
 * useDocumentStatus Hook
 * Polls document status until it's ready or failed
 */

import { useEffect, useRef } from 'react';

export function useDocumentStatus(
  docId: string | null,
  currentStatus: string | undefined,
  onStatusChange: () => void
) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Only poll if document is in a processing state
    if (!docId || !currentStatus) return;
    if (currentStatus === 'ready' || currentStatus === 'failed') return;

    // Poll every 3 seconds
    intervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/documents/${docId}/status`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'ready' || data.status === 'failed') {
            onStatusChange();
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
            }
          }
        }
      } catch (error) {
        console.error('Error polling status:', error);
      }
    }, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [docId, currentStatus, onStatusChange]);
}
