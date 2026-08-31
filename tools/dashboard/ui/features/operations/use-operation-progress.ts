import { useEffect, useState, useCallback, useRef } from 'react';
import type { OperationEvent, OperationSnapshot } from './types';
import { OPERATION_SSE_EVENT_TYPES, applyOperationEvent, fetchOperationSnapshot } from './operation-snapshot.ts';

export interface UseOperationProgressResult {
  snapshot: OperationSnapshot | null;
  loading: boolean;
  error: string | null;
  isTerminal: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  refetch: () => Promise<void>;
}

export function useOperationProgress(
  operationId: string | null,
  onTerminal?: (snapshot: OperationSnapshot) => void,
): UseOperationProgressResult {
  const [snapshot, setSnapshot] = useState<OperationSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(operationId));
  const [error, setError] = useState<string | null>(null);
  const terminalNotifiedRef = useRef<boolean>(false);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  const fetchSnapshot = useCallback(async (id: string): Promise<OperationSnapshot | null> => {
    try {
      return await fetchOperationSnapshot(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    }
  }, []);

  const refetch = useCallback(async () => {
    if (!operationId) return;
    setLoading(true);
    const snap = await fetchSnapshot(operationId);
    if (snap) {
      setSnapshot(snap);
      if (snap.status === 'completed' || snap.status === 'failed') {
        if (!terminalNotifiedRef.current) {
          terminalNotifiedRef.current = true;
          onTerminalRef.current?.(snap);
        }
      }
    }
    setLoading(false);
  }, [fetchSnapshot, operationId]);

  useEffect(() => {
    if (!operationId) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      terminalNotifiedRef.current = false;
      return;
    }

    let isSubscribed = true;
    let eventSource: EventSource | null = null;
    terminalNotifiedRef.current = false;
    setLoading(true);
    setError(null);

    async function initialize() {
      if (!operationId) return;
      const initialSnap = await fetchSnapshot(operationId);
      if (!isSubscribed) return;

      if (!initialSnap) {
        setLoading(false);
        return;
      }

      setSnapshot(initialSnap);
      setLoading(false);

      if (initialSnap.status === 'completed' || initialSnap.status === 'failed') {
        if (!terminalNotifiedRef.current) {
          terminalNotifiedRef.current = true;
          onTerminalRef.current?.(initialSnap);
        }
        return;
      }

      // Stream live events via SSE
      const url = `/api/operations/${encodeURIComponent(operationId)}/events?after=${initialSnap.lastEventId || 0}`;
      eventSource = new EventSource(url);

      const handleEventData = (eventData: string) => {
        if (!isSubscribed) return;
        try {
          const parsed = JSON.parse(eventData) as OperationEvent;
          setSnapshot((prev) => {
            if (!prev) return parsed as unknown as OperationSnapshot;
            const next = applyOperationEvent(prev, parsed);
            if (next.status === 'completed' || next.status === 'failed') {
              if (!terminalNotifiedRef.current) {
                terminalNotifiedRef.current = true;
                onTerminalRef.current?.(next);
              }
              eventSource?.close();
            }
            return next;
          });
        } catch {
          // Ignore unparseable SSE frame
        }
      };

      eventSource.onmessage = (event) => handleEventData(event.data);

      for (const type of OPERATION_SSE_EVENT_TYPES) {
        eventSource.addEventListener(type, (event: MessageEvent) => {
          handleEventData(event.data);
        });
      }

      eventSource.onerror = () => {
        if (!isSubscribed) return;
        // On connection drop or error, fallback to snapshot poll to check if finished
        fetchSnapshot(operationId).then((latest) => {
          if (isSubscribed && latest) {
            setSnapshot(latest);
            if (latest.status === 'completed' || latest.status === 'failed') {
              if (!terminalNotifiedRef.current) {
                terminalNotifiedRef.current = true;
                onTerminalRef.current?.(latest);
              }
              eventSource?.close();
            }
          }
        });
      };
    }

    initialize();

    return () => {
      isSubscribed = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fetchSnapshot, operationId]);

  const isCompleted = snapshot?.status === 'completed';
  const isFailed = snapshot?.status === 'failed';
  const isTerminal = isCompleted || isFailed;

  return {
    snapshot,
    loading,
    error,
    isTerminal,
    isCompleted,
    isFailed,
    refetch,
  };
}
