import { existsSync, readFileSync } from 'node:fs';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Encodes an arbitrary opaque providerSessionId into a safe single directory segment.
 * If providerSessionId is a safe single filesystem segment (conservative chars,
 * reasonable length, not '.' or '..', and not a Windows reserved device name), checks
 * for case-insensitive collisions against existing directories. If safe and uncollided,
 * returns it directly. Otherwise, encodes it using a collision-resistant SHA-256 digest
 * suffix to prevent path traversal, device name collisions, and case collisions.
 */
export function rawCaptureSessionDirectory(providerSessionId, rawCaptureDir = null) {
  if (!providerSessionId || typeof providerSessionId !== 'string') {
    throw new TypeError('providerSessionId must be a non-empty string');
  }
  const isSafeCandidate = /^[a-zA-Z0-9_-]+$/.test(providerSessionId)
    && providerSessionId !== '.'
    && providerSessionId !== '..'
    && providerSessionId.length <= 128
    && !WINDOWS_RESERVED_NAMES.has(providerSessionId.toLowerCase());

  if (isSafeCandidate) {
    if (!rawCaptureDir) {
      return providerSessionId;
    }
    const candidateDir = join(rawCaptureDir, providerSessionId);
    if (!existsSync(candidateDir)) {
      return providerSessionId;
    }
    // Candidate exists on disk (could be existing session or case collision on Windows/macOS)
    const metaPath = join(candidateDir, 'session.json');
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        if (meta.providerSessionId === providerSessionId) {
          // Exact case-sensitive match belongs to the same session
          return providerSessionId;
        }
      } catch {
        // Corrupted metadata, fall back to hash
      }
    } else {
      const rawPath = join(candidateDir, 'raw.ndjson');
      if (!existsSync(rawPath)) {
        return providerSessionId;
      }
    }
    // If directory exists on disk for a different session or different case-variant, fall back to hash
  }

  const safePrefix = providerSessionId
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 32)
    .replace(/^_+|_+$/g, '') || 'session';
  const hash = createHash('sha256').update(providerSessionId, 'utf8').digest('hex').slice(0, 16);
  return `${safePrefix}-${hash}`;
}

export class RawCaptureRecorder {
  #providerId;
  #rawCaptureDir;
  #rawCaptureEnabled;
  #rawFlushTimeoutMs;
  #loggedSessions = new Set();
  #sessionWriteQueues = new Map();
  #sessionDirMap = new Map();

  constructor({
    providerId,
    rawCaptureDir = null,
    rawCaptureEnabled = false,
    rawFlushTimeoutMs = 2_000,
  } = {}) {
    if (!providerId || typeof providerId !== 'string') {
      throw new TypeError('providerId must be a non-empty string');
    }
    this.#providerId = providerId;
    this.#rawCaptureEnabled = Boolean(rawCaptureEnabled);
    this.#rawFlushTimeoutMs = Number.isFinite(rawFlushTimeoutMs) && rawFlushTimeoutMs >= 0
      ? rawFlushTimeoutMs
      : 2_000;
    this.#rawCaptureDir = this.#rawCaptureEnabled
      ? (rawCaptureDir ? resolve(rawCaptureDir) : null)
      : (rawCaptureDir ? resolve(rawCaptureDir) : null);
  }

  get isEnabled() {
    return this.#rawCaptureEnabled;
  }

  get rawCaptureDir() {
    return this.#rawCaptureDir;
  }

  get rawFlushTimeoutMs() {
    return this.#rawFlushTimeoutMs;
  }

  resolveSessionDirName(sessionId) {
    if (!sessionId || sessionId === '_global') return '_global';
    let dirName = this.#sessionDirMap.get(sessionId);
    if (!dirName) {
      const lowerSession = sessionId.toLowerCase();
      let hasInMemoryCaseCollision = false;
      for (const [existingId, existingDir] of this.#sessionDirMap.entries()) {
        if (existingId !== sessionId && existingDir.toLowerCase() === lowerSession) {
          hasInMemoryCaseCollision = true;
          break;
        }
      }

      if (hasInMemoryCaseCollision) {
        const safePrefix = sessionId
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 32)
          .replace(/^_+|_+$/g, '') || 'session';
        const hash = createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 16);
        dirName = `${safePrefix}-${hash}`;
      } else {
        dirName = rawCaptureSessionDirectory(sessionId, this.#rawCaptureDir);
      }
      this.#sessionDirMap.set(sessionId, dirName);
    }
    return dirName;
  }

  getRawCapturePath(sessionId) {
    if (!this.#rawCaptureEnabled || !this.#rawCaptureDir) return null;
    const sessionDir = this.resolveSessionDirName(sessionId);
    return join(this.#rawCaptureDir, sessionDir, 'raw.ndjson');
  }

  logCapturePathOnce(sessionId, customLabel = null) {
    if (!this.#rawCaptureEnabled || !this.#rawCaptureDir) return;
    const key = (sessionId && sessionId !== '_global') ? sessionId : '_global';
    if (!this.#loggedSessions.has(key)) {
      this.#loggedSessions.add(key);
      const sessionDirName = this.resolveSessionDirName(sessionId);
      const filePath = join(this.#rawCaptureDir, sessionDirName, 'raw.ndjson');
      const label = customLabel || (this.#providerId.charAt(0).toUpperCase() + this.#providerId.slice(1));
      console.log(`[ai] ${label} raw capture: ${filePath}`);
    }
  }

  recordRawEvent({
    sessionId = null,
    turnId = null,
    requestId = null,
    serverRequestId = null,
    backfill = false,
    stream,
    line,
    raw,
    rawText,
    suppressConsoleLog = false,
  }) {
    if (!this.#rawCaptureEnabled || !this.#rawCaptureDir) {
      return;
    }
    if (typeof line !== 'string' && raw === undefined && rawText === undefined) {
      return;
    }

    const effectiveSessionId = (sessionId && sessionId !== '_global') ? sessionId : null;
    const queueKey = effectiveSessionId || '_global';
    const capturedAt = new Date().toISOString();

    let record = {
      capturedAt,
      stream,
      providerSessionId: effectiveSessionId,
      ...(turnId ? { turnId } : {}),
      ...(requestId !== null && requestId !== undefined ? { requestId } : {}),
      ...(serverRequestId !== null && serverRequestId !== undefined ? { serverRequestId } : {}),
      ...(backfill ? { backfill: true } : {}),
    };

    if (raw !== undefined) {
      record.raw = raw;
    } else if (typeof rawText === 'string') {
      record.rawText = rawText;
    } else {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        record.raw = JSON.parse(trimmed);
      } catch {
        record.rawText = line;
      }
    }

    const sessionDirName = this.resolveSessionDirName(effectiveSessionId);
    const sessionDir = join(this.#rawCaptureDir, sessionDirName);
    const filePath = join(sessionDir, 'raw.ndjson');

    if (!suppressConsoleLog) {
      this.logCapturePathOnce(effectiveSessionId);
    }

    const ndjsonLine = JSON.stringify(record) + '\n';
    let queue = this.#sessionWriteQueues.get(queueKey) || Promise.resolve();
    queue = queue
      .then(async () => {
        try {
          if (!existsSync(sessionDir)) {
            await mkdir(sessionDir, { recursive: true });
          }
          const sessionMetadataPath = join(sessionDir, 'session.json');
          if (!existsSync(sessionMetadataPath)) {
            const metadata = effectiveSessionId
              ? JSON.stringify({
                  provider: this.#providerId,
                  providerSessionId: effectiveSessionId,
                }, null, 2)
              : JSON.stringify({
                  provider: this.#providerId,
                  global: true,
                }, null, 2);
            await writeFile(sessionMetadataPath, metadata, 'utf8');
          }
          await appendFile(filePath, ndjsonLine, 'utf8');
        } catch (err) {
          console.warn(`[${this.#providerId}] [raw-capture] Failed to append raw event for ${queueKey}: ${err?.message || err}`);
        }
      })
      .catch(err => {
        console.warn(`[${this.#providerId}] [raw-capture] Unexpected error in raw capture queue: ${err?.message || err}`);
      });
    this.#sessionWriteQueues.set(queueKey, queue);
  }

  async flushRawCapture(sessionId) {
    const queueKey = (sessionId && sessionId !== '_global') ? sessionId : '_global';
    const queue = this.#sessionWriteQueues.get(queueKey);
    if (queue) await queue;
  }

  async #awaitRawCaptureBoundary(queue, label) {
    if (!queue) return;
    if (this.#rawFlushTimeoutMs === 0) {
      await queue;
      return;
    }

    let timer;
    let timedOut = false;
    await Promise.race([
      Promise.resolve(queue),
      new Promise(resolveTimeout => {
        timer = setTimeout(() => {
          timedOut = true;
          resolveTimeout();
        }, this.#rawFlushTimeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut) {
      console.warn(`[${this.#providerId}] [raw-capture] Timed out after ${this.#rawFlushTimeoutMs}ms while flushing ${label}; queued writes continue in the background.`);
    }
  }

  async flushRawCaptureBounded(sessionId) {
    const queueKey = (sessionId && sessionId !== '_global') ? sessionId : '_global';
    await this.#awaitRawCaptureBoundary(
      this.#sessionWriteQueues.get(queueKey),
      sessionId ? `session ${sessionId}` : 'global diagnostics',
    );
  }

  async flushAllRawCapture() {
    const firstQueues = [...this.#sessionWriteQueues.values()];
    await this.#awaitRawCaptureBoundary(Promise.allSettled(firstQueues), 'all sessions');
    const finalQueues = [...this.#sessionWriteQueues.values()];
    if (finalQueues.length !== firstQueues.length || finalQueues.some((queue, index) => queue !== firstQueues[index])) {
      await this.#awaitRawCaptureBoundary(Promise.allSettled(finalQueues), 'final session writes');
    }
  }
}
