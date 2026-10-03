// Neutral, feature-agnostic HTTP transport for human-owned workflow steps (Task 16, D14, D17).
// Shared layer purity: imports nothing from features/**, screens/**, routes/**, or app/**.

export interface HumanStepActionOptions {
  source?: string;
  slug: string;
  taskId: string;
  action: 'start' | 'submit';
  result?: string;
  feedback?: string;
  artifacts?: unknown;
}

export interface HumanStepActionResult {
  ok: boolean;
  action: 'start' | 'submit';
  taskId: string;
  result?: unknown;
  [key: string]: unknown;
}

export class HumanStepRequestError extends Error {
  status: number;
  code?: string;
  stepId?: string;
  executor?: string;
  allowedResults?: string[];
  blockedBy?: string[];
  details?: Record<string, unknown>;

  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HumanStepRequestError';
    this.status = typeof data.status === 'number' ? data.status : 400;
    this.code = typeof data.code === 'string' ? data.code : undefined;
    this.stepId = typeof data.stepId === 'string' ? data.stepId : undefined;
    this.executor = typeof data.executor === 'string' ? data.executor : undefined;
    this.allowedResults = Array.isArray(data.allowedResults) ? (data.allowedResults as string[]) : undefined;
    this.blockedBy = Array.isArray(data.blockedBy) ? (data.blockedBy as string[]) : undefined;
    this.details = typeof data.details === 'object' && data.details !== null ? (data.details as Record<string, unknown>) : undefined;
  }
}

/**
 * Sends a human-step action request to the dashboard server.
 * Plain async function without React or query cache dependencies.
 */
export async function postHumanStepAction({
  source,
  slug,
  taskId,
  action,
  result,
  feedback,
  artifacts,
}: HumanStepActionOptions): Promise<HumanStepActionResult> {
  const encodedSlug = encodeURIComponent(slug);
  const encodedTaskId = encodeURIComponent(taskId);
  const url = source
    ? `/api/specs/${encodeURIComponent(source)}/${encodedSlug}/tasks/${encodedTaskId}/workflow/human-step`
    : `/api/specs/${encodedSlug}/tasks/${encodedTaskId}/workflow/human-step`;

  const body: Record<string, unknown> = { action };
  if (result !== undefined) body.result = result;
  if (feedback !== undefined) body.feedback = feedback;
  if (artifacts !== undefined) body.artifacts = artifacts;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const message = (typeof data.error === 'string' && data.error) || `Human-step action '${action}' failed with status ${res.status}`;
    throw new HumanStepRequestError(message, { ...data, status: res.status });
  }

  return data as unknown as HumanStepActionResult;
}
