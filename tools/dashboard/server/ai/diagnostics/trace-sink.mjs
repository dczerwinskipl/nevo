import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createTraceRecord, validateTraceRecord } from './trace-record.mjs';

export class LifecycleTraceSink {
  #baseDir;
  #maxFiles;
  #maxFileSizeBytes;
  #enabled;
  #activeBuffers = new Map(); // turnId -> TraceRecord[]
  #writeQueues = new Map(); // turnId -> Promise chain
  #lastError = null;
  #errorCount = 0;

  constructor({ baseDir = null, maxFiles = 500, maxFileSizeBytes = 5_000_000, enabled = true } = {}) {
    this.#baseDir = baseDir ? resolve(baseDir) : resolve(process.cwd(), '.nevo-ai-local', 'lifecycle_traces');
    this.#maxFiles = maxFiles;
    this.#maxFileSizeBytes = maxFileSizeBytes;
    this.#enabled = enabled;

    if (this.#enabled) {
      try {
        mkdirSync(this.#baseDir, { recursive: true });
      } catch (err) {
        this.#recordSinkError('Initialization failed', err);
      }
    }
  }

  get baseDir() {
    return this.#baseDir;
  }

  get enabled() {
    return this.#enabled;
  }

  get lastError() {
    return this.#lastError;
  }

  get errorCount() {
    return this.#errorCount;
  }

  #recordSinkError(op, err) {
    this.#errorCount += 1;
    this.#lastError = {
      operation: op,
      message: err?.message || String(err),
      timestamp: new Date().toISOString(),
    };
    // Non-fatal warning
    console.warn(`[ai-lifecycle-diagnostics] Trace sink error (${op}): ${err?.message || err}`);
  }

  #getFilePath(turnId) {
    const safeId = String(turnId).replace(/[^A-Za-z0-9._-]/g, '_');
    return join(this.#baseDir, `${safeId}.ndjson`);
  }

  createTurnTracer({ turnId, sessionId, provider, providerSessionId }) {
    let currentSeq = 0;
    const startTime = performance.now();

    return {
      record: (eventData) => {
        currentSeq += 1;
        const elapsedMs = Math.round(performance.now() - startTime);
        const record = createTraceRecord({
          seq: currentSeq,
          turnId,
          sessionId,
          provider,
          providerSessionId,
          elapsedMs,
          ...eventData,
        });
        return this.appendRecord(record);
      },
      flush: async () => {
        return this.flushTurn(turnId);
      },
    };
  }

  appendRecord(rawRecord) {
    let validated;
    try {
      validated = validateTraceRecord(rawRecord);
    } catch (err) {
      this.#recordSinkError('validation', err);
      return null;
    }

    const { turnId } = validated;

    // 1. Maintain in-memory buffer
    if (!this.#activeBuffers.has(turnId)) {
      this.#activeBuffers.set(turnId, []);
    }
    const buffer = this.#activeBuffers.get(turnId);
    buffer.push(validated);

    // Keep in-memory buffer bounded to 1000 items
    if (buffer.length > 1000) {
      buffer.shift();
    }

    if (!this.#enabled) {
      return validated;
    }

    // 2. Queue serialized disk append
    const line = JSON.stringify(validated) + '\n';
    const filePath = this.#getFilePath(turnId);

    const previousPromise = this.#writeQueues.get(turnId) || Promise.resolve();
    const nextPromise = previousPromise
      .then(async () => {
        await mkdir(this.#baseDir, { recursive: true });
        await appendFile(filePath, line, 'utf-8');
      })
      .catch((err) => {
        this.#recordSinkError(`append:${turnId}`, err);
      });

    this.#writeQueues.set(turnId, nextPromise);
    return validated;
  }

  async flushTurn(turnId) {
    const queue = this.#writeQueues.get(turnId);
    if (queue) {
      await queue;
      this.#writeQueues.delete(turnId);
    }
    await this.pruneOldTraces();
  }

  async flushAll() {
    const promises = Array.from(this.#writeQueues.values());
    await Promise.allSettled(promises);
    this.#writeQueues.clear();
    await this.pruneOldTraces();
  }

  getTrace(turnId) {
    // 1. Check in-memory buffer
    if (this.#activeBuffers.has(turnId)) {
      return [...this.#activeBuffers.get(turnId)];
    }

    // 2. Read from disk if exists
    if (!this.#enabled) return [];
    const filePath = this.#getFilePath(turnId);
    if (!existsSync(filePath)) return [];

    try {
      const content = readFileSync(filePath, 'utf-8');
      return content
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch (err) {
      this.#recordSinkError(`read:${turnId}`, err);
      return [];
    }
  }

  exportTrace(turnId) {
    const records = this.getTrace(turnId);
    return {
      turnId,
      recordCount: records.length,
      exportedAt: new Date().toISOString(),
      records,
    };
  }

  async pruneOldTraces() {
    if (!this.#enabled || !existsSync(this.#baseDir)) return;

    try {
      const files = await readdir(this.#baseDir);
      const traceFiles = [];

      for (const file of files) {
        if (!file.endsWith('.ndjson')) continue;
        const fullPath = join(this.#baseDir, file);
        try {
          const st = await stat(fullPath);
          traceFiles.push({ file, fullPath, mtimeMs: st.mtimeMs, size: st.size });
        } catch {}
      }

      if (traceFiles.length > this.#maxFiles) {
        // Sort oldest first
        traceFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
        const excess = traceFiles.length - this.#maxFiles;
        for (let i = 0; i < excess; i++) {
          try {
            await unlink(traceFiles[i].fullPath);
          } catch {}
        }
      }
    } catch (err) {
      this.#recordSinkError('prune', err);
    }
  }
}

let globalTraceSink = null;

export function getGlobalTraceSink() {
  if (!globalTraceSink) {
    globalTraceSink = new LifecycleTraceSink();
  }
  return globalTraceSink;
}

export function setGlobalTraceSink(sink) {
  globalTraceSink = sink;
}
