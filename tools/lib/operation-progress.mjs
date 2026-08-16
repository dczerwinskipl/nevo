// tools/lib/operation-progress.mjs — shared progress events contract & emission helper

export const PROGRESS_PREFIX = '@@nevo:progress@@ ';

export const PROGRESS_EVENT_TYPES = Object.freeze([
  'operation.started',
  'operation.step.started',
  'operation.step.progress',
  'operation.step.completed',
  'operation.step.failed',
  'operation.completed',
  'operation.failed',
]);

/**
 * Format a progress event to an NDJSON line prefixed by PROGRESS_PREFIX.
 */
export function formatProgressEvent(type, payload = {}, clock = () => new Date()) {
  const timestamp = (clock instanceof Function ? clock() : new Date()).toISOString();
  const event = {
    type,
    timestamp,
    ...payload,
  };
  return `${PROGRESS_PREFIX}${JSON.stringify(event)}\n`;
}

/**
 * Parse a raw stdout line. Returns the parsed event object if the line matches
 * the progress event framing, or null otherwise.
 */
export function parseProgressLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith(PROGRESS_PREFIX)) return null;
  const rawJson = trimmed.slice(PROGRESS_PREFIX.length);
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Create a structured progress emitter writing to an output stream (e.g. process.stdout).
 */
export function createProgressEmitter({
  out = process.stdout,
  clock = () => new Date(),
} = {}) {
  function emit(type, payload = {}) {
    const formatted = formatProgressEvent(type, payload, clock);
    if (out && typeof out.write === 'function') {
      out.write(formatted);
    }
    return parseProgressLine(formatted);
  }

  return {
    emit,
    operationStarted({ type, totalSteps, steps = [] } = {}) {
      return emit('operation.started', {
        ...(type !== undefined ? { operationType: type } : {}),
        ...(totalSteps !== undefined ? { totalSteps } : {}),
        ...(steps.length ? { steps } : {}),
      });
    },
    stepStarted({ id, label, total } = {}) {
      return emit('operation.step.started', {
        id,
        label,
        ...(total !== undefined ? { total } : {}),
      });
    },
    stepProgress({ id, current, total, detail } = {}) {
      return emit('operation.step.progress', {
        id,
        ...(current !== undefined ? { current } : {}),
        ...(total !== undefined ? { total } : {}),
        ...(detail !== undefined ? { detail } : {}),
      });
    },
    stepCompleted({ id, detail } = {}) {
      return emit('operation.step.completed', {
        id,
        ...(detail !== undefined ? { detail } : {}),
      });
    },
    stepFailed({ id, error, detail } = {}) {
      const errorObj = typeof error === 'string'
        ? { message: error }
        : (error && typeof error === 'object' ? { message: error.message || String(error), code: error.code } : { message: 'Step failed' });
      return emit('operation.step.failed', {
        id,
        error: errorObj,
        ...(detail !== undefined ? { detail } : {}),
      });
    },
    operationCompleted({ result, summary } = {}) {
      return emit('operation.completed', {
        ...(result !== undefined ? { result } : {}),
        ...(summary !== undefined ? { summary } : {}),
      });
    },
    operationFailed({ error, summary } = {}) {
      const errorObj = typeof error === 'string'
        ? { message: error }
        : (error && typeof error === 'object' ? { message: error.message || String(error), code: error.code } : { message: 'Operation failed' });
      return emit('operation.failed', {
        error: errorObj,
        ...(summary !== undefined ? { summary } : {}),
      });
    },
  };
}
