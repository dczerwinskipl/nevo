import type { OperationSnapshot } from './types';
import { OPERATION_SSE_EVENT_TYPES, applyOperationEvent, fetchOperationSnapshot } from './operation-snapshot.ts';

/**
 * Explicit result contract for `waitForOperationTerminal` — a caller (e.g. sequential
 * batch orchestration) must be able to distinguish "this operation is authoritatively
 * done" from every other way waiting can end, since only the former may safely unblock
 * dependent work. A timeout or a status-read failure is a *safety stop*, never evidence
 * that the operation finished (area spec-detail-and-workflow-feature-slice, task 05
 * review fix).
 */
export type OperationWaitOutcome =
  | { kind: 'completed'; snapshot: OperationSnapshot }
  | { kind: 'failed'; snapshot: OperationSnapshot }
  /** The bounded wait elapsed with no terminal state observed — the operation may still be running server-side. */
  | { kind: 'timeout'; snapshot: OperationSnapshot | null }
  /** The operation's status could not be established at all (fetch failure). */
  | { kind: 'error'; message: string };

// Self-check operations chain this task's own "## Verification" commands (often
// `npm test` + a dashboard build) in one operation, and `finalize` can trigger a full
// `dotnet build`/`dotnet test` — both routinely exceed a minute on a cold cache. 60s
// was observed to be too tight for legitimate operations; 5 minutes leaves headroom
// without letting a genuinely stuck stream block a batch indefinitely.
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

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
 * stuck/undeliverable stream must not hang a batch forever) — its firing is reported as
 * its own `'timeout'` outcome, never folded into `'completed'`.
 */
export function waitForOperationTerminal(
  operationId: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<OperationWaitOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let eventSource: EventSource | null = null;
    let latest: OperationSnapshot | null = null;

    const timeoutHandle = setTimeout(() => finish({ kind: 'timeout', snapshot: latest }), timeoutMs);

    function finish(outcome: OperationWaitOutcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      eventSource?.close();
      resolve(outcome);
    }

    function observeSnapshot(snapshot: OperationSnapshot) {
      latest = snapshot;
      if (snapshot.status === 'completed') finish({ kind: 'completed', snapshot });
      else if (snapshot.status === 'failed') finish({ kind: 'failed', snapshot });
    }

    (async () => {
      let snapshot: OperationSnapshot;
      try {
        snapshot = await fetchOperationSnapshot(operationId);
      } catch (err) {
        finish({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (settled) return;
      observeSnapshot(snapshot);
      if (settled) return;

      const url = `/api/operations/${encodeURIComponent(operationId)}/events?after=${snapshot.lastEventId || 0}`;
      eventSource = new EventSource(url);

      const handleEventData = (eventData: string) => {
        if (settled) return;
        try {
          const parsed = JSON.parse(eventData);
          observeSnapshot(applyOperationEvent(latest as OperationSnapshot, parsed));
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
        // A failed fallback poll is not itself fatal — the browser's automatic
        // EventSource reconnect, a later poll, or the timeout will resolve this.
        fetchOperationSnapshot(operationId)
          .then((snap) => {
            if (settled) return;
            observeSnapshot(snap);
          })
          .catch(() => {});
      };
    })();
  });
}
