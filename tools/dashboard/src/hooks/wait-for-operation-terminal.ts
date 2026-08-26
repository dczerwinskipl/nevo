import type { OperationSnapshot } from '@/lib/types';
import { OPERATION_SSE_EVENT_TYPES, applyOperationEvent, fetchOperationSnapshot, isOperationTerminal } from './operation-snapshot.ts';

/**
 * Promise-based sibling of `useOperationProgress` for callers outside React's render
 * cycle — e.g. sequential batch orchestration that must await one operation's terminal
 * state before starting the next. Built on the exact same fetch/SSE/reducer primitives
 * (`operation-snapshot.ts`) the live progress modal uses, so there is one canonical
 * "is this operation done yet" protocol, not a second raw-polling implementation
 * (area spec-detail-and-workflow-feature-slice, task 05).
 *
 * The backend's own `operation.completed` / `operation.failed` terminal state is the
 * authoritative completion boundary — this resolves as soon as that state is observed,
 * with no artificial settle delay. `timeoutMs` is a best-effort safety valve only (a
 * stuck/undeliverable stream must not hang a batch forever); it does not assert
 * anything about the operation's own correctness.
 */
export function waitForOperationTerminal(
  operationId: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<OperationSnapshot | null> {
  return new Promise((resolve) => {
    let settled = false;
    let eventSource: EventSource | null = null;
    let latest: OperationSnapshot | null = null;

    const timeoutHandle = setTimeout(() => finish(latest), timeoutMs);

    function finish(snapshot: OperationSnapshot | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      eventSource?.close();
      resolve(snapshot);
    }

    (async () => {
      let snapshot: OperationSnapshot;
      try {
        snapshot = await fetchOperationSnapshot(operationId);
      } catch {
        finish(null);
        return;
      }
      if (settled) return;
      latest = snapshot;
      if (isOperationTerminal(snapshot)) {
        finish(snapshot);
        return;
      }

      const url = `/api/operations/${encodeURIComponent(operationId)}/events?after=${snapshot.lastEventId || 0}`;
      eventSource = new EventSource(url);

      const handleEventData = (eventData: string) => {
        if (settled) return;
        try {
          const parsed = JSON.parse(eventData);
          latest = applyOperationEvent(latest as OperationSnapshot, parsed);
          if (isOperationTerminal(latest)) finish(latest);
        } catch {
          // Ignore unparseable SSE frame
        }
      };

      eventSource.onmessage = (event) => handleEventData(event.data);
      for (const type of OPERATION_SSE_EVENT_TYPES) {
        eventSource.addEventListener(type, (event: MessageEvent) => handleEventData(event.data));
      }
      eventSource.onerror = () => {
        if (settled) return;
        // On connection drop or error, fall back to a snapshot poll to check if finished.
        fetchOperationSnapshot(operationId).then((snap) => {
          if (settled) return;
          latest = snap;
          if (isOperationTerminal(snap)) finish(snap);
        }).catch(() => {});
      };
    })();
  });
}
