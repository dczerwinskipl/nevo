import type { OperationSnapshot, OperationEvent } from '@/lib/types';

/**
 * Framework-free core for "what is this operation's current state, and has it reached
 * a terminal one" — the one canonical protocol against `/api/operations/:id` +
 * `/api/operations/:id/events`. `use-operation-progress.ts` (live modal rendering) and
 * `wait-for-operation-terminal.ts` (imperative batch orchestration) both build on these
 * exact functions so there is never a second, differently-shaped polling implementation
 * (area spec-detail-and-workflow-feature-slice).
 */

export const OPERATION_SSE_EVENT_TYPES = [
  'snapshot',
  'operation.started',
  'operation.step.started',
  'operation.step.progress',
  'operation.step.completed',
  'operation.step.failed',
  'operation.completed',
  'operation.failed',
] as const;

export async function fetchOperationSnapshot(operationId: string): Promise<OperationSnapshot> {
  const res = await fetch(`/api/operations/${encodeURIComponent(operationId)}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Operation '${operationId}' not found.`);
    throw new Error(`Failed to fetch operation (${res.status})`);
  }
  return (await res.json()) as OperationSnapshot;
}

export function isOperationTerminal(snapshot: OperationSnapshot | null | undefined): boolean {
  return snapshot?.status === 'completed' || snapshot?.status === 'failed';
}

export function applyOperationEvent(prev: OperationSnapshot, event: OperationEvent): OperationSnapshot {
  const updated = { ...prev };
  if (typeof event.id === 'number') {
    updated.lastEventId = event.id;
  }

  if (event.type === 'snapshot' || ((event as { status?: string }).status && Array.isArray((event as { steps?: unknown[] }).steps))) {
    return event as unknown as OperationSnapshot;
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
}
