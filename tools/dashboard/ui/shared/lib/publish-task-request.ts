// Neutral, feature-agnostic HTTP transport for publishing deterministic workflow tasks.
// Shared layer purity: imports nothing from features/**, screens/**, routes/**, or app/**.

export interface PublishTaskOptions {
  source?: string;
  slug: string;
  taskId: string;
}

export interface BatchPublishOptions {
  source?: string;
  slug: string;
  taskIds?: string[];
  status?: string;
}

export interface PublishTaskResult {
  ok: boolean;
  changeSlug: string;
  taskId: string;
  status: string;
}

export interface BatchPublishResult {
  ok: boolean;
  changeSlug: string;
  published: string[];
  total: number;
}

export class PublishTaskRequestError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PublishTaskRequestError';
    this.status = typeof data.status === 'number' ? data.status : 400;
    this.code = typeof data.code === 'string' ? data.code : undefined;
    this.details = typeof data.details === 'object' && data.details !== null ? (data.details as Record<string, unknown>) : undefined;
  }
}

/**
 * Sends a task publish request to the dashboard server.
 * Plain async function without React or query cache dependencies.
 */
export async function postPublishTask({
  source,
  slug,
  taskId,
}: PublishTaskOptions): Promise<PublishTaskResult> {
  const encodedSlug = encodeURIComponent(slug);
  const encodedTaskId = encodeURIComponent(taskId);
  const url = source
    ? `/api/specs/${encodeURIComponent(source)}/${encodedSlug}/tasks/${encodedTaskId}/workflow/publish`
    : `/api/specs/${encodedSlug}/tasks/${encodedTaskId}/workflow/publish`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const message = (typeof data.error === 'string' && data.error) || `Publish task '${taskId}' failed with status ${res.status}`;
    throw new PublishTaskRequestError(message, { ...data, status: res.status });
  }

  return data as unknown as PublishTaskResult;
}

/**
 * Sends a batch publish request to the dashboard server.
 * Plain async function without React or query cache dependencies.
 */
export async function postBatchPublish({
  source,
  slug,
  taskIds,
  status,
}: BatchPublishOptions): Promise<BatchPublishResult> {
  const encodedSlug = encodeURIComponent(slug);
  const url = source
    ? `/api/specs/${encodeURIComponent(source)}/${encodedSlug}/workflow/publish`
    : `/api/specs/${encodedSlug}/workflow/publish`;

  const body: Record<string, unknown> = {};
  if (Array.isArray(taskIds)) body.taskIds = taskIds;
  if (status !== undefined) body.status = status;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const message = (typeof data.error === 'string' && data.error) || `Batch publish failed with status ${res.status}`;
    throw new PublishTaskRequestError(message, { ...data, status: res.status });
  }

  return data as unknown as BatchPublishResult;
}
