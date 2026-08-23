import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdir, appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  AiError,
  AiValidationError,
  CapabilityNotSupportedError,
  validateAgentExecutionMode,
} from './contracts.mjs';
import { terminateChildProcess } from './process-termination.mjs';

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

export const ANTIGRAVITY_CAPABILITIES = Object.freeze({
  interactivePermissions: false,
  interactiveQuestions: true,
  interactiveConfirmations: false,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
});

export const ANTIGRAVITY_DESCRIPTOR = Object.freeze({
  id: 'antigravity',
  label: 'Antigravity / Gemini',
  enabled: true,
  capabilities: ANTIGRAVITY_CAPABILITIES,
  supportedModes: ['ask', 'edit', 'agent'],
  defaultMode: 'edit',
});

function resolveAgyExecutable(name) {
  if (!name || name === 'agy') {
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? `${process.env.USERPROFILE}\\AppData\\Local` : null);
      if (localAppData) {
        const standardPath = `${localAppData}\\agy\\bin\\agy.exe`;
        if (existsSync(standardPath)) {
          return standardPath;
        }
      }
    }
  }
  return name;
}

export function defaultProbeAntigravityExecutable(executable) {
  try {
    if (existsSync(executable)) {
      return true;
    }
    const probe = process.platform === 'win32' ? `where.exe "${executable}"` : `which "${executable}"`;
    execSync(probe, { stdio: 'ignore', timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

export function extractFinalResponse(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // 1. Direct string in raw.result (e.g. { type: 'done', result: '...' } or { event: 'result', result: '...' })
  if (typeof raw.result === 'string') return raw.result;
  // 2. Object in raw.result with response property (e.g. { event: 'result', result: { response: '...' } })
  if (raw.result && typeof raw.result === 'object' && typeof raw.result.response === 'string') {
    return raw.result.response;
  }
  // 3. Direct response property on raw (e.g. { type: 'done', response: '...' })
  if (typeof raw.response === 'string') {
    return raw.response;
  }
  return null;
}

export class AntigravityAgentProvider {
  #executable;
  #cwd;
  #spawnProcess;
  #activeOperations = new Map();
  #materializedSessions = new Set();
  #sessionAliases = new Map();
  #mappingFilePath;
  #availabilityCache = { checkedAt: 0, result: null };
  #cancelGraceMs;
  #forceGraceMs;
  #probeExecutable;
  #rawCaptureDir;
  #rawCaptureEnabled;
  #loggedCaptureSessions = new Set();
  #sessionWriteQueues = new Map();
  #sessionDirMap = new Map();

  constructor({
    executable = 'agy',
    cwd = process.cwd(),
    spawnProcess = spawn,
    cancelGraceMs = 5_000,
    forceGraceMs = 2_000,
    probeExecutable,
    materializedSessions,
    mappingFilePath = null,
    rawCaptureDir = null,
    rawCaptureEnabled = false,
  } = {}) {
    this.#executable = resolveAgyExecutable(executable);
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.#cancelGraceMs = cancelGraceMs;
    this.#forceGraceMs = forceGraceMs;
    this.#probeExecutable = probeExecutable ?? (spawnProcess !== spawn ? () => true : defaultProbeAntigravityExecutable);
    this.#mappingFilePath = mappingFilePath;
    this.#rawCaptureEnabled = Boolean(rawCaptureEnabled);
    this.#rawCaptureDir = this.#rawCaptureEnabled
      ? (rawCaptureDir || resolve(this.#cwd, '.nevo-ai-local', 'antigravity_raw'))
      : (rawCaptureDir ? resolve(rawCaptureDir) : null);
    if (Array.isArray(materializedSessions)) {
      this.#materializedSessions = new Set(materializedSessions);
    }
    this.#loadSessionAliases();
    this.descriptor = ANTIGRAVITY_DESCRIPTOR;
  }

  #resolveSessionDirName(sessionId) {
    if (!sessionId) return null;
    let dirName = this.#sessionDirMap.get(sessionId);
    if (!dirName) {
      // Check for in-memory case-insensitive collision against existing reservations
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
    if (!sessionId || !this.#rawCaptureDir) return null;
    const sessionDir = this.#resolveSessionDirName(sessionId);
    return join(this.#rawCaptureDir, sessionDir, 'raw.ndjson');
  }

  async flushRawCapture(sessionId) {
    if (!sessionId) return;
    const queue = this.#sessionWriteQueues.get(sessionId);
    if (queue) await queue;
  }

  #logCapturePathOnce(sessionId) {
    if (!this.#rawCaptureEnabled || !this.#rawCaptureDir || !sessionId) return;
    if (!this.#loggedCaptureSessions.has(sessionId)) {
      this.#loggedCaptureSessions.add(sessionId);
      const sessionDirName = this.#resolveSessionDirName(sessionId);
      const filePath = join(this.#rawCaptureDir, sessionDirName, 'raw.ndjson');
      console.log(`[ai] Antigravity raw capture: ${filePath}`);
    }
  }

  #recordRawEvent({ sessionId, turnId, stream, line, suppressConsoleLog = false }) {
    if (!this.#rawCaptureEnabled || !this.#rawCaptureDir || !sessionId || typeof line !== 'string') {
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) return;

    const capturedAt = new Date().toISOString();
    let record;
    try {
      const parsed = JSON.parse(trimmed);
      record = {
        capturedAt,
        stream,
        providerSessionId: sessionId,
        ...(turnId ? { turnId } : {}),
        raw: parsed,
      };
    } catch {
      record = {
        capturedAt,
        stream,
        providerSessionId: sessionId,
        ...(turnId ? { turnId } : {}),
        rawText: line,
      };
    }

    const sessionDirName = this.#resolveSessionDirName(sessionId);
    const sessionDir = join(this.#rawCaptureDir, sessionDirName);
    const filePath = join(sessionDir, 'raw.ndjson');

    if (!suppressConsoleLog) {
      this.#logCapturePathOnce(sessionId);
    }

    const ndjsonLine = JSON.stringify(record) + '\n';
    let queue = this.#sessionWriteQueues.get(sessionId) || Promise.resolve();
    queue = queue
      .then(async () => {
        try {
          if (!existsSync(sessionDir)) {
            await mkdir(sessionDir, { recursive: true });
          }
          const sessionMetadataPath = join(sessionDir, 'session.json');
          if (!existsSync(sessionMetadataPath)) {
            const metadata = JSON.stringify({
              provider: 'antigravity',
              providerSessionId: sessionId,
            }, null, 2);
            await writeFile(sessionMetadataPath, metadata, 'utf8');
          }
          await appendFile(filePath, ndjsonLine, 'utf8');
        } catch (err) {
          console.warn(`[antigravity] [raw-capture] Failed to append raw event for session ${sessionId}: ${err?.message || err}`);
        }
      })
      .catch(err => {
        console.warn(`[antigravity] [raw-capture] Unexpected error in raw capture queue: ${err?.message || err}`);
      });
    this.#sessionWriteQueues.set(sessionId, queue);
  }

  #loadSessionAliases() {
    try {
      if (this.#mappingFilePath && existsSync(this.#mappingFilePath)) {
        const raw = JSON.parse(readFileSync(this.#mappingFilePath, 'utf8'));
        if (raw && typeof raw === 'object') {
          for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'string') {
              this.#sessionAliases.set(k, v);
              this.#materializedSessions.add(v);
              this.#materializedSessions.add(k);
            }
          }
        }
      }
    } catch {}
  }

  #saveSessionAlias(fromId, toId) {
    if (!fromId || !toId) return;
    this.#sessionAliases.set(fromId, toId);
    this.#sessionAliases.set(toId, toId);
    this.#materializedSessions.add(fromId);
    this.#materializedSessions.add(toId);
    if (!this.#mappingFilePath) return;
    try {
      const dir = dirname(this.#mappingFilePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const obj = Object.fromEntries(this.#sessionAliases.entries());
      writeFileSync(this.#mappingFilePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch {}
  }

  isAvailable({ ttlMs = 30_000 } = {}) {
    const now = Date.now();
    if (this.#availabilityCache.result && (now - this.#availabilityCache.checkedAt < ttlMs)) {
      return this.#availabilityCache.result;
    }
    let available = false;
    try {
      available = Boolean(this.#probeExecutable(this.#executable));
    } catch {
      available = false;
    }
    const result = available
      ? { available: true }
      : { available: false, unavailableReason: `Antigravity CLI ('${this.#executable}') is not found in PATH. Install Antigravity CLI ('agy') to enable this provider.` };
    this.#availabilityCache = { checkedAt: now, result };
    return result;
  }

  async startTurn({
    turnId,
    providerSessionId,
    setProviderSessionId,
    identity,
    message,
    prompt,
    mode: rawMode,
    emitDelta,
    emitTextDelta,
    emitReasoningDelta,
    emitToolStarted,
    emitToolUpdated,
    emitToolCompleted,
    emitUsageUpdated,
    requestInteraction,
    signal,
    setOperation,
  } = {}) {
    const inputMessage = message ?? prompt;
    if (!inputMessage || typeof inputMessage !== 'string') {
      throw new AiValidationError('A valid message/prompt is required.');
    }
    const mode = rawMode ? validateAgentExecutionMode(rawMode) : 'edit';

    const effectiveSessionId = providerSessionId || randomUUID();
    let isSessionEstablished = false;
    let accumulatedText = '';

    const sendTextDelta = (chunk) => {
      if (!chunk) return;
      accumulatedText += chunk;
      if (emitTextDelta) emitTextDelta(chunk);
      else if (emitDelta) emitDelta(chunk);
    };

    return new Promise((resolve, reject) => {
      let activeTool = null;
      let lineBuffer = '';
      let isDone = false;
      let isResolved = false;
      let pendingInteractionPromise = null;

      const args = [
        '--add-dir', this.#cwd,
        '--output-format', 'stream-json',
      ];

      if (mode === 'ask') {
        args.push('--mode=plan');
      } else if (mode === 'agent') {
        args.push('--mode=accept-edits', '--dangerously-skip-permissions');
      } else {
        args.push('--mode=accept-edits');
      }

      const targetConversationId = providerSessionId
        ? (this.#sessionAliases.get(providerSessionId) || (this.#materializedSessions.has(providerSessionId) ? providerSessionId : null))
        : null;

      if (targetConversationId) {
        args.push('--conversation', targetConversationId);
      }

      args.push('--print', inputMessage);

      const operation = {
        turnId,
        providerSessionId: effectiveSessionId,
        cancelled: false,
        child: null,
        isResolved: false,
        isDone: false,
        postResultTimer: null,
      };

      if (setOperation) setOperation(operation);
      this.#activeOperations.set(turnId, operation);

      let currentSessionId = providerSessionId || null;
      const isProvisional = !providerSessionId;
      let isRawCaptureMigrated = false;

      const confirmSession = async (allocatedId) => {
        if (allocatedId) {
          this.#saveSessionAlias(effectiveSessionId, allocatedId);
          if (providerSessionId) {
            this.#saveSessionAlias(providerSessionId, allocatedId);
          }
          if (this.#rawCaptureEnabled && this.#rawCaptureDir && allocatedId !== effectiveSessionId && !isRawCaptureMigrated) {
            isRawCaptureMigrated = true;
            // Migrate any raw records already written under effectiveSessionId to allocatedId
            const oldDirName = this.#resolveSessionDirName(effectiveSessionId);
            const newDirName = this.#resolveSessionDirName(allocatedId);
            const oldQueue = this.#sessionWriteQueues.get(effectiveSessionId) || Promise.resolve();
            const migrationQueue = oldQueue.then(async () => {
              try {
                const oldFile = join(this.#rawCaptureDir, oldDirName, 'raw.ndjson');
                if (existsSync(oldFile)) {
                  const newDir = join(this.#rawCaptureDir, newDirName);
                  if (!existsSync(newDir)) await mkdir(newDir, { recursive: true });
                  const newFile = join(newDir, 'raw.ndjson');
                  const content = await readFile(oldFile, 'utf8');
                  const rewritten = content
                    .trim()
                    .split('\n')
                    .filter(Boolean)
                    .map(line => {
                      try {
                        const parsed = JSON.parse(line);
                        parsed.providerSessionId = allocatedId;
                        return JSON.stringify(parsed);
                      } catch {
                        return line;
                      }
                    })
                    .join('\n') + '\n';
                  await appendFile(newFile, rewritten, 'utf8');

                  // Write updated session.json for allocatedId
                  const sessionMetadataPath = join(newDir, 'session.json');
                  const metadata = JSON.stringify({
                    provider: 'antigravity',
                    providerSessionId: allocatedId,
                  }, null, 2);
                  await writeFile(sessionMetadataPath, metadata, 'utf8');

                  await rm(join(this.#rawCaptureDir, oldDirName), { recursive: true, force: true });
                }
              } catch (err) {
                console.warn(`[antigravity] [raw-capture] Failed to migrate initial session capture: ${err?.message || err}`);
              }
            });
            this.#sessionWriteQueues.set(allocatedId, migrationQueue);
            this.#logCapturePathOnce(allocatedId);
          } else if (this.#rawCaptureEnabled && this.#rawCaptureDir && allocatedId) {
            this.#logCapturePathOnce(allocatedId);
          }
        }
        if (!isSessionEstablished && allocatedId) {
          isSessionEstablished = true;
          currentSessionId = allocatedId;
          operation.providerSessionId = allocatedId;
          if (setProviderSessionId) {
            await setProviderSessionId(allocatedId);
          }
        }
      };

      let child;
      try {
        child = this.#spawnProcess(this.#executable, args, {
          cwd: this.#cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          env: {
            ...process.env,
            AGY_INTERACTIVE: '0',
            FORCE_COLOR: '0',
          },
        });
        operation.child = child;
      } catch (err) {
        this.#activeOperations.delete(turnId);
        const msg = err.code === 'ENOENT'
          ? `Antigravity CLI ('${this.#executable}') not found. Ensure Antigravity CLI ('agy') is installed and available in PATH.`
          : `Failed to spawn Antigravity CLI: ${err.message}`;
        return reject(new AiError('AI_PROVIDER_SPAWN_ERROR', msg, { cause: err }));
      }

      const settleAuthoritativeTerminal = ({ outcome = 'completed', error = null } = {}) => {
        if (isResolved) return;
        isResolved = true;
        isDone = true;
        operation.isResolved = true;
        operation.isDone = true;

        if (outcome === 'failed') {
          reject(error || new AiError('AI_PROVIDER_ERROR', 'Antigravity turn failed.'));
        } else {
          resolve({
            turnId,
            providerSessionId: currentSessionId || effectiveSessionId,
            status: 'completed',
          });
        }

        // Retain process ownership and initiate bounded graceful termination if child process has not exited yet
        if (child && !child.killed && child.exitCode === null) {
          operation.postResultTimer = setTimeout(() => {
            if (child && child.exitCode === null) {
              terminateChildProcess(child, {
                graceMs: this.#cancelGraceMs,
                forceGraceMs: this.#forceGraceMs,
              }).catch(() => {});
            }
          }, this.#cancelGraceMs);
        }
      };

      const finishTurn = () => {
        settleAuthoritativeTerminal({ outcome: 'completed' });
      };

      const failAuthoritativeTerminal = (err) => {
        settleAuthoritativeTerminal({ outcome: 'failed', error: err });
      };

      const failTurn = (err) => {
        if (isResolved) return;
        isResolved = true;
        isDone = true;
        operation.isResolved = true;
        operation.isDone = true;
        if (operation.postResultTimer) {
          clearTimeout(operation.postResultTimer);
          operation.postResultTimer = null;
        }
        this.#activeOperations.delete(turnId);
        reject(err);
      };

      if (signal) {
        signal.addEventListener('abort', () => {
          operation.cancelled = true;
          if (operation.postResultTimer) {
            clearTimeout(operation.postResultTimer);
            operation.postResultTimer = null;
          }
          if (child) {
            terminateChildProcess(child, {
              graceMs: this.#cancelGraceMs,
              forceGraceMs: this.#forceGraceMs,
            }).catch(() => {});
          }
        }, { once: true });
      }

      const processLine = async (line) => {
        if (isDone || isResolved) {
          return;
        }
        const trimmed = line.trim();
        if (!trimmed) return;

        let raw;
        try {
          raw = JSON.parse(trimmed);
        } catch {
          // Fallback to plain streaming text if not JSON
          if (!isDone && !isResolved) {
            sendTextDelta(trimmed + '\n');
          }
          return;
        }

        const eventType = raw.event || raw.type;
        const payload = raw.step_update || raw.result || raw.init || raw;
        const sessId = raw.conversation_id || raw.conversationId || payload.conversation_id || payload.conversationId || raw.session_id || raw.sessionId;
        if (sessId) {
          this.#saveSessionAlias(effectiveSessionId, sessId);
          if (providerSessionId) {
            this.#saveSessionAlias(providerSessionId, sessId);
          }
          await confirmSession(sessId);
        }

        if (eventType === 'init' || eventType === 'conversation_started') {
          return;
        }

        if (eventType === 'step_update') {
          if (payload.text_delta) {
            sendTextDelta(payload.text_delta);
          }
          if (payload.thought || payload.thinking) {
            if (emitReasoningDelta) emitReasoningDelta(payload.thought || payload.thinking);
          }
          if (payload.step_type === 'tool' || payload.tool_name) {
            const toolId = payload.toolId || `tool-${payload.step_index ?? randomUUID()}`;
            const toolName = payload.tool_name || payload.toolName || payload.tool_info?.name || 'tool';
            const input = payload.tool_info?.parameters || payload.input || payload.args || {};

            if (payload.state === 'ACTIVE') {
              activeTool = { id: toolId, name: toolName, input };
              if (emitToolStarted) {
                emitToolStarted({
                  toolId,
                  toolName,
                  input,
                });
              }
            } else if (payload.state === 'DONE' || payload.state === 'ERROR' || payload.state === 'COMPLETED') {
              const output = payload.tool_info?.output || (payload.tool_info?.error ? payload.tool_info.error.message : payload.output || 'executed');
              const status = payload.state === 'ERROR' || payload.is_error ? 'failed' : 'completed';
              if (emitToolCompleted) {
                emitToolCompleted({
                  toolId,
                  output,
                  status,
                  durationMs: payload.duration_seconds ? Math.round(payload.duration_seconds * 1000) : undefined,
                });
              }
              if (activeTool && activeTool.id === toolId) {
                activeTool = null;
              }
            }
          }
          if (payload.usage && emitUsageUpdated) {
            emitUsageUpdated({
              tokensIn: payload.usage.input_tokens || payload.usage.tokensIn,
              tokensOut: payload.usage.output_tokens || payload.usage.tokensOut,
              cost: payload.usage.cost,
            });
          }
          return;
        }

        switch (eventType) {
          case 'text':
          case 'text.delta':
          case 'content': {
            const delta = raw.text ?? raw.delta ?? raw.content ?? '';
            if (delta) sendTextDelta(delta);
            break;
          }

          case 'reasoning':
          case 'reasoning.delta':
          case 'thought': {
            const reasoning = raw.reasoning ?? raw.delta ?? raw.thought ?? '';
            if (reasoning && emitReasoningDelta) emitReasoningDelta(reasoning);
            break;
          }

          case 'tool_use':
          case 'tool.started':
          case 'call': {
            activeTool = {
              id: raw.toolId || raw.id || `tool-${randomUUID()}`,
              name: raw.toolName || raw.name || 'tool',
              input: raw.input || raw.args || {},
            };
            if (emitToolStarted) {
              emitToolStarted({
                toolId: activeTool.id,
                toolName: activeTool.name,
                input: activeTool.input,
              });
            }
            break;
          }

          case 'tool.updated': {
            if (emitToolUpdated && (raw.toolId || activeTool)) {
              emitToolUpdated({
                toolId: raw.toolId || activeTool?.id,
                status: raw.status || 'running',
                input: raw.input,
              });
            }
            break;
          }

          case 'tool_result':
          case 'tool.completed':
          case 'tool_use_result': {
            const toolId = raw.toolId || raw.tool_use_id || activeTool?.id;
            const output = raw.output ?? raw.content ?? raw.result ?? 'executed';
            if (toolId && emitToolCompleted) {
              emitToolCompleted({
                toolId,
                output,
                status: raw.is_error || raw.status === 'failed' ? 'failed' : 'completed',
                durationMs: raw.durationMs,
              });
            }
            if (activeTool && activeTool.id === toolId) {
              activeTool = null;
            }
            break;
          }

          case 'question':
          case 'interaction_request': {
            if (requestInteraction) {
              const interaction = {
                id: raw.interactionId || `int-${randomUUID()}`,
                kind: 'question',
                prompt: raw.question || raw.prompt || 'Antigravity requested input',
                questions: raw.questions || [{
                  id: raw.questionId || 'q1',
                  question: raw.question || raw.prompt || 'Antigravity requested input',
                  header: raw.header || 'Pytanie',
                  options: raw.options || [],
                  isMultiSelect: Boolean(raw.isMultiSelect),
                }],
              };
              pendingInteractionPromise = requestInteraction(interaction);
            }
            break;
          }

          case 'usage': {
            if (emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: raw.tokensIn || raw.input_tokens,
                tokensOut: raw.tokensOut || raw.output_tokens,
                cost: raw.cost,
              });
            }
            break;
          }

          case 'result':
          case 'done':
          case 'turn.completed': {
            if (activeTool) {
              // Reaching a normal completion signal while this tool never received its
              // own real terminal outcome is not evidence it succeeded (owner-decisions.md
              // D6) — resolves to 'failed', not 'completed'.
              if (emitToolCompleted) {
                emitToolCompleted({ toolId: activeTool.id, output: 'executed', status: 'failed' });
              }
              activeTool = null;
            }
            const finalText = extractFinalResponse(raw);
            if (finalText) {
              if (!accumulatedText) {
                sendTextDelta(finalText);
              } else if (finalText === accumulatedText) {
                // Already fully streamed, do not duplicate
              } else if (finalText.startsWith(accumulatedText)) {
                sendTextDelta(finalText.slice(accumulatedText.length));
              } else if (!accumulatedText.endsWith(finalText) && !accumulatedText.includes(finalText)) {
                sendTextDelta(finalText);
              }
            }
            const usageObj = payload?.usage || raw.usage;
            if (usageObj && emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: usageObj.tokensIn || usageObj.input_tokens,
                tokensOut: usageObj.tokensOut || usageObj.output_tokens,
                cost: usageObj.cost,
              });
            }

            const statusValue = payload?.status || raw.status;
            const statusIndicatesError = typeof statusValue === 'string'
              && (statusValue.toUpperCase() === 'ERROR' || statusValue.toUpperCase() === 'FAILED');
            const explicitErrorFlag = payload?.is_error === true || raw.is_error === true;
            const isTerminalError = statusIndicatesError || explicitErrorFlag;

            if (isTerminalError && !accumulatedText && !finalText) {
              const rawErr = payload?.error ?? raw.error;
              const errorMessage = (typeof rawErr === 'string' ? rawErr : (rawErr?.message || payload?.message || raw.message)) || 'Antigravity turn failed.';
              failAuthoritativeTerminal(new AiError('AI_PROVIDER_ERROR', errorMessage));
              break;
            }

            isDone = true;
            if (pendingInteractionPromise) {
              pendingInteractionPromise.then(() => finishTurn()).catch(err => failTurn(err));
            } else {
              finishTurn();
            }
            break;
          }

          case 'error': {
            failTurn(new AiError('AI_PROVIDER_ERROR', raw.error?.message || raw.message || 'Antigravity turn failed.'));
            break;
          }

          default:
            break;
        }
      };

      let processingQueue = Promise.resolve();

      let stderrBuffer = '';
      let stderrLineBuffer = '';

      child.stdout?.on('data', chunk => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
          const sessIdForCapture = currentSessionId || effectiveSessionId;
          this.#recordRawEvent({
            sessionId: sessIdForCapture,
            turnId,
            stream: 'stdout',
            line,
            suppressConsoleLog: isProvisional && !isSessionEstablished,
          });
          if (!isDone && !isResolved) {
            processingQueue = processingQueue.then(() => {
              if (isDone || isResolved) return;
              return processLine(line);
            }).catch(err => {
              failTurn(err);
            });
          }
        }
      });

      child.stderr?.on('data', chunk => {
        const text = chunk.toString();
        stderrBuffer += text;
        stderrLineBuffer += text;
        const lines = stderrLineBuffer.split('\n');
        stderrLineBuffer = lines.pop() || '';
        for (const line of lines) {
          const sessIdForCapture = currentSessionId || effectiveSessionId;
          this.#recordRawEvent({
            sessionId: sessIdForCapture,
            turnId,
            stream: 'stderr',
            line,
            suppressConsoleLog: isProvisional && !isSessionEstablished,
          });
        }
        console.warn(`[antigravity] [stderr] ${text.trim()}`);
      });

      child.on('error', err => {
        if (operation.postResultTimer) {
          clearTimeout(operation.postResultTimer);
          operation.postResultTimer = null;
        }
        if (isResolved) {
          this.#activeOperations.delete(turnId);
          return;
        }
        const msg = err.code === 'ENOENT'
          ? `Antigravity CLI ('${this.#executable}') not found. Ensure Antigravity CLI ('agy') is installed and available in PATH.`
          : `Antigravity process error: ${err.message}`;
        failTurn(new AiError('AI_PROVIDER_PROCESS_ERROR', msg, { cause: err }));
      });

      child.on('close', async exitCode => {
        if (operation.postResultTimer) {
          clearTimeout(operation.postResultTimer);
          operation.postResultTimer = null;
        }

        // Always flush residual stdout lineBuffer to raw capture on process close
        if (lineBuffer) {
          const sessIdForCapture = currentSessionId || effectiveSessionId;
          this.#recordRawEvent({
            sessionId: sessIdForCapture,
            turnId,
            stream: 'stdout',
            line: lineBuffer,
            suppressConsoleLog: isProvisional && !isSessionEstablished,
          });
        }

        // Always flush residual stderrLineBuffer to raw capture on process close
        if (stderrLineBuffer) {
          const sessIdForCapture = currentSessionId || effectiveSessionId;
          this.#recordRawEvent({
            sessionId: sessIdForCapture,
            turnId,
            stream: 'stderr',
            line: stderrLineBuffer,
            suppressConsoleLog: isProvisional && !isSessionEstablished,
          });
          stderrLineBuffer = '';
        }

        // If turn ended without establishing session, ensure any unlogged provisional capture is logged
        if (isProvisional && !isSessionEstablished) {
          this.#logCapturePathOnce(effectiveSessionId);
        }

        if (isResolved) {
          this.#activeOperations.delete(turnId);
          return;
        }

        try {
          await processingQueue;
        } catch (e) {
          return failTurn(e);
        }

        if (!isResolved && lineBuffer && lineBuffer.trim()) {
          try {
            await processLine(lineBuffer);
          } catch (e) {
            return failTurn(e);
          }
        }

        if (isResolved) {
          this.#activeOperations.delete(turnId);
          return;
        }

        // Evaluate cancellation/exit-outcome before determining what happened to a
        // still-active tool (owner-decisions.md D6) — a tool lingering at close time
        // never received a real successful terminal signal, so it always resolves to
        // 'failed', whether the process was cancelled, exited non-zero, or (per D6's
        // governing invariant) even closed normally while this tool was still running.
        const wasCancelled = operation.cancelled;
        const hadNonZeroExit = exitCode !== 0 && !isDone;

        if (activeTool) {
          if (emitToolCompleted) {
            emitToolCompleted({ toolId: activeTool.id, output: 'executed', status: 'failed' });
          }
          activeTool = null;
        }

        if (wasCancelled) {
          return failTurn(new AiError('AI_TURN_CANCELLED', 'Antigravity turn was cancelled.', { status: 409 }));
        }

        if (pendingInteractionPromise) {
          try {
            await pendingInteractionPromise;
          } catch (e) {
            return failTurn(e);
          }
        }

        if (hadNonZeroExit) {
          const detail = stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : '.';
          return failTurn(new AiError('AI_PROVIDER_EXIT_ERROR', `Antigravity process exited with non-zero code ${exitCode}${detail}`));
        }

        finishTurn();
        this.#activeOperations.delete(turnId);
      });

      // Send prompt / message to child stdin
      try {
        const payload = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: inputMessage,
          },
        });
        child.stdin.write(payload + '\n');
        child.stdin.end();
      } catch (err) {
        failTurn(new AiError('AI_PROVIDER_WRITE_ERROR', `Failed to write to Antigravity stdin: ${err.message}`, { cause: err }));
      }
    });
  }

  async cancelTurn({ turnId, providerSessionId, operation: passedOp } = {}) {
    const operation = passedOp || (turnId ? this.#activeOperations.get(turnId) : null);
    if (operation) {
      operation.cancelled = true;
      if (operation.postResultTimer) {
        clearTimeout(operation.postResultTimer);
        operation.postResultTimer = null;
      }
      const child = operation.child;
      if (child) {
        try {
          const result = await terminateChildProcess(child, {
            graceMs: this.#cancelGraceMs,
            forceGraceMs: this.#forceGraceMs,
          });
          if (!result.terminated) {
            throw new AiError('AI_PROCESS_TERMINATION_FAILED', 'Failed to terminate Antigravity CLI process within bounded timeout.', { status: 500 });
          }
        } finally {
          if (turnId) {
            this.#activeOperations.delete(turnId);
          }
        }
      } else {
        if (turnId) {
          this.#activeOperations.delete(turnId);
        }
      }
    }
    return { cancelled: true };
  }

  async respondInteraction(providerSessionId, interactionId, response) {
    if (response?.kind === 'permission' || (!response?.answers && response?.decision)) {
      throw new CapabilityNotSupportedError('antigravity', 'interactivePermissions');
    }
    return { resolved: true, interactionId };
  }
}

export function createAntigravityAgentProvider(options = {}) {
  return new AntigravityAgentProvider({
    mappingFilePath: null,
    ...options,
  });
}
