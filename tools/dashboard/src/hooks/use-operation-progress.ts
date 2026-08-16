import { useEffect, useState, useCallback, useRef } from 'react';
import type { OperationSnapshot, OperationEvent, OperationStep } from '@/lib/types';

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
      const res = await fetch(`/api/operations/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error(`Operation '${id}' not found.`);
        throw new Error(`Failed to fetch operation (${res.status})`);
      }
      const data = (await res.json()) as OperationSnapshot;
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    }
  }, []);

  const applyEvent = useCallback((prev: OperationSnapshot, event: OperationEvent): OperationSnapshot => {
    const updated = { ...prev };
    if (typeof event.id === 'number') {
      updated.lastEventId = event.id;
    }

    if (event.type === 'operation.started') {
      updated.status = 'running';
      if (Array.isArray(event.steps)) {
        updated.steps = (event.steps as Array<{ id: string; label: string }>).map(s => ({
          id: s.id,
          label: s.label,
          status: 'pending',
        }));
      }
    } else if (event.type === 'operation.step.started') {
      const stepId = typeof (event as { stepId?: string }).stepId === 'string' && (event as { stepId?: string }).stepId
        ? (event as { stepId?: string }).stepId!
        : (typeof event.id === 'string' && isNaN(Number(event.id)) ? event.id : '');
      if (!stepId) return updated;

      const stepLabel = event.label as string | undefined;
      const existing = updated.steps.find(s => s.id === stepId);
      if (existing) {
        existing.status = 'running';
        if (stepLabel) existing.label = stepLabel;
        if (typeof event.total === 'number') existing.total = event.total;
        if (typeof event.current === 'number') existing.current = event.current;
        if (typeof event.detail === 'string') existing.detail = event.detail;
      } else {
        updated.steps = [
          ...updated.steps,
          {
            id: stepId,
            label: stepLabel || stepId,
            status: 'running',
            total: typeof event.total === 'number' ? event.total : undefined,
            current: typeof event.current === 'number' ? event.current : undefined,
            detail: typeof event.detail === 'string' ? event.detail : undefined,
          },
        ];
      }
    } else if (event.type === 'operation.step.completed') {
      const stepId = typeof (event as { stepId?: string }).stepId === 'string' && (event as { stepId?: string }).stepId
        ? (event as { stepId?: string }).stepId!
        : (typeof event.id === 'string' && isNaN(Number(event.id)) ? event.id : '');
      if (!stepId) return updated;

      const existing = updated.steps.find(s => s.id === stepId);
      if (existing) {
        existing.status = 'completed';
        if (typeof event.detail === 'string') existing.detail = event.detail;
      } else {
        updated.steps = [
          ...updated.steps,
          { id: stepId, label: stepId, status: 'completed', detail: typeof event.detail === 'string' ? event.detail : undefined },
        ];
      }
    } else if (event.type === 'operation.step.failed') {
      const stepId = typeof (event as { stepId?: string }).stepId === 'string' && (event as { stepId?: string }).stepId
        ? (event as { stepId?: string }).stepId!
        : (typeof event.id === 'string' && isNaN(Number(event.id)) ? event.id : '');
      if (!stepId) return updated;

      const errorObj = typeof event.error === 'string' ? { message: event.error } : (event.error as { message: string; code?: string } | undefined);
      const existing = updated.steps.find(s => s.id === stepId);
      if (existing) {
        existing.status = 'failed';
        if (errorObj) existing.error = errorObj;
      } else {
        updated.steps = [
          ...updated.steps,
          { id: stepId, label: stepId, status: 'failed', error: errorObj },
        ];
      }
    } else if (event.type === 'operation.completed') {
      updated.status = 'completed';
      if (event.result !== undefined) updated.result = event.result;
      if (typeof event.completedAt === 'string') updated.completedAt = event.completedAt;
    } else if (event.type === 'operation.failed') {
      updated.status = 'failed';
      if (event.error) {
        updated.error = typeof event.error === 'string' ? { message: event.error } : (event.error as { message: string; code?: string });
      }
      if (typeof event.completedAt === 'string') updated.completedAt = event.completedAt;
    }

    return updated;
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

      eventSource.onmessage = (event) => {
        if (!isSubscribed) return;
        try {
          const parsed = JSON.parse(event.data) as OperationEvent;
          setSnapshot((prev) => {
            if (!prev) return prev;
            const next = applyEvent(prev, parsed);
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
  }, [applyEvent, fetchSnapshot, operationId]);

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
