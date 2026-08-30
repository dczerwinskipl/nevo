import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AiError } from '../../contracts.mjs';
import { terminateChildProcess, waitForChildExit } from '../process-termination.mjs';
import { RawCaptureRecorder, rawCaptureSessionDirectory } from '../raw-capture.mjs';

export { rawCaptureSessionDirectory };

const DEFAULT_CLIENT_INFO = Object.freeze({
  name: 'nevo',
  title: 'NEvo',
  version: '0.1.0',
});

/**
 * Resolve the common Windows npm launcher without `shell: true`. The npm `.cmd`
 * shim cannot be spawned directly with shell disabled, while its Node entrypoint can.
 */
export function resolveCodexCommand(executable = 'codex') {
  if (process.platform !== 'win32' || executable !== 'codex') {
    return { executable, argsPrefix: [] };
  }

  const installRoots = [
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : null,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
  ].filter(Boolean);
  for (const root of installRoots) {
    const launcher = join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (!existsSync(launcher)) continue;
    const systemNode = join(root, 'node.exe');
    return {
      executable: existsSync(systemNode) ? systemNode : process.execPath,
      argsPrefix: [launcher],
    };
  }
  return { executable, argsPrefix: [] };
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function protocolError(message, details) {
  return new AiError('AI_PROVIDER_PROTOCOL_ERROR', message, {
    status: 502,
    details,
  });
}

function providerFailure(code, message, details, cause) {
  return new AiError(code, message, {
    status: 502,
    details,
    cause,
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRequestId(id) {
  return (typeof id === 'string' && id.length > 0) ||
    (typeof id === 'number' && Number.isFinite(id));
}

function validateParams(params, method) {
  if (params !== undefined && !isObject(params)) {
    throw protocolError(`Codex '${method}' params must be an object when present.`);
  }
}

function validateInitializeResult(result) {
  if (!isObject(result)) {
    throw protocolError('Codex initialize response must contain an object result.');
  }
  for (const field of ['codexHome', 'platformFamily', 'platformOs', 'userAgent']) {
    if (typeof result[field] !== 'string' || result[field].length === 0) {
      throw protocolError(`Codex initialize response is missing '${field}'.`);
    }
  }
  return result;
}

/**
 * Persistent, provider-private JSONL client for `codex app-server --listen stdio://`.
 * Raw app-server envelopes never escape this boundary.
 */
export class CodexAppServerClient {
  #executable;
  #argsPrefix;
  #cwd;
  #env;
  #spawnProcess;
  #clientInfo;
  #initializeCapabilities;
  #child = null;
  #initializationPromise = null;
  #initializationResult = null;
  #disposed = false;
  #disposePromise = null;
  #failure = null;
  #nextRequestId = 1;
  #pendingRequests = new Map();
  #activeServerRequests = new Map();
  #notificationSubscribers = new Set();
  #serverRequestSubscribers = new Set();
  #waiters = new Set();
  #stdoutBuffer = '';
  #processingQueue = Promise.resolve();
  #stderr = '';
  #maxStderrBytes;
  #disposeGraceMs;
  #forceGraceMs;
  #listeners = null;
  #rawCapture;

  constructor({
    executable = 'codex',
    cwd = process.cwd(),
    env = process.env,
    spawnProcess = spawn,
    clientInfo = DEFAULT_CLIENT_INFO,
    initializeCapabilities = { experimentalApi: true },
    maxStderrBytes = 8_192,
    disposeGraceMs = 500,
    forceGraceMs = 2_000,
    commandResolver = resolveCodexCommand,
    rawCaptureDir = null,
    rawCaptureEnabled = false,
    rawFlushTimeoutMs = 2_000,
    rawCaptureRecorder = null,
  } = {}) {
    const command = commandResolver(executable);
    this.#executable = command.executable;
    this.#argsPrefix = command.argsPrefix ?? [];
    this.#cwd = cwd;
    this.#env = env;
    this.#spawnProcess = spawnProcess;
    this.#clientInfo = Object.freeze({ ...clientInfo });
    this.#initializeCapabilities = Object.freeze({ ...initializeCapabilities });
    this.#maxStderrBytes = maxStderrBytes;
    this.#disposeGraceMs = disposeGraceMs;
    this.#forceGraceMs = forceGraceMs;
    this.#rawCapture = rawCaptureRecorder ?? new RawCaptureRecorder({
      providerId: 'codex',
      rawCaptureDir: rawCaptureEnabled
        ? (rawCaptureDir || resolve(cwd, '.nevo-ai-local', 'codex_raw'))
        : (rawCaptureDir ? resolve(rawCaptureDir) : null),
      rawCaptureEnabled,
      rawFlushTimeoutMs,
    });
  }

  get rawCapture() {
    return this.#rawCapture;
  }

  getRawCapturePath(sessionId) {
    return this.#rawCapture.getRawCapturePath(sessionId);
  }

  async flushRawCapture(sessionId) {
    return this.#rawCapture.flushRawCapture(sessionId);
  }

  get pendingRequestCount() {
    return this.#pendingRequests.size;
  }

  get activeWaiterCount() {
    return this.#waiters.size;
  }

  get isDisposed() {
    return this.#disposed;
  }

  get initializationResult() {
    return this.#initializationResult;
  }

  async initialize() {
    return this.#ensureInitialized();
  }

  async request(method, params = {}) {
    if (typeof method !== 'string' || method.length === 0 || method === 'initialize') {
      throw protocolError('A non-initialize Codex request method is required.');
    }
    validateParams(params, method);
    await this.#ensureInitialized();
    return this.#sendRequest(method, params);
  }

  onNotification(handler) {
    if (typeof handler !== 'function') throw new TypeError('Notification handler must be a function.');
    this.#assertUsable();
    this.#notificationSubscribers.add(handler);
    return () => this.#notificationSubscribers.delete(handler);
  }

  onServerRequest(handler) {
    if (typeof handler !== 'function') throw new TypeError('Server-request handler must be a function.');
    this.#assertUsable();
    this.#serverRequestSubscribers.add(handler);
    return () => this.#serverRequestSubscribers.delete(handler);
  }

  waitForNotification(predicate, { signal } = {}) {
    if (typeof predicate !== 'function') throw new TypeError('Notification predicate must be a function.');
    this.#assertUsable();

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, signal, onAbort: null };
      const remove = () => {
        this.#waiters.delete(waiter);
        if (signal && waiter.onAbort) signal.removeEventListener('abort', waiter.onAbort);
      };
      waiter.resolve = value => {
        remove();
        resolve(value);
      };
      waiter.reject = error => {
        remove();
        reject(error);
      };
      if (signal) {
        waiter.onAbort = () => waiter.reject(new AiError('AI_TURN_CANCELLED', 'Codex turn wait was cancelled.', { status: 409 }));
        if (signal.aborted) return waiter.onAbort();
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.#waiters.add(waiter);
    });
  }

  async dispose() {
    if (this.#disposePromise) return this.#disposePromise;

    this.#disposed = true;
    const disposalError = new AiError('AI_PROVIDER_DISPOSED', 'Codex app-server client was disposed.', { status: 503 });
    this.#tripFailure(disposalError);

    this.#disposePromise = (async () => {
      const child = this.#child;
      if (!child) {
        await this.#rawCapture.flushAllRawCapture();
        return;
      }

      try {
        if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) {
          child.stdin.end();
        }
      } catch {}

      let exited = await waitForChildExit(child, this.#disposeGraceMs);
      if (!exited) {
        const result = await terminateChildProcess(child, {
          graceMs: this.#disposeGraceMs,
          forceGraceMs: this.#forceGraceMs,
        });
        exited = result.terminated;
      }

      await this.#processingQueue.catch(() => {});

      try {
        await this.#rawCapture.flushAllRawCapture();
      } catch (err) {
        console.warn(`[codex] [raw-capture] Failed to flush raw capture on client dispose: ${err?.message || err}`);
      }

      this.#removeProcessListeners();
      if (!exited) {
        throw new AiError(
          'AI_PROCESS_TERMINATION_FAILED',
          'Failed to terminate Codex app-server within the bounded timeout.',
          { status: 500 },
        );
      }
    })();

    return this.#disposePromise;
  }

  #assertUsable() {
    if (this.#failure) throw this.#failure;
    if (this.#disposed) {
      throw new AiError('AI_PROVIDER_DISPOSED', 'Codex app-server client was disposed.', { status: 503 });
    }
  }

  async #ensureInitialized() {
    this.#assertUsable();
    if (this.#initializationResult) return this.#initializationResult;
    if (this.#initializationPromise) return this.#initializationPromise;

    this.#initializationPromise = (async () => {
      this.#startProcess();
      try {
        const result = validateInitializeResult(await this.#sendRequest('initialize', {
          clientInfo: this.#clientInfo,
          capabilities: this.#initializeCapabilities,
        }));
        this.#writeEnvelope({ method: 'initialized' });
        this.#initializationResult = result;
        return result;
      } catch (error) {
        const failure = error?.code === 'AI_PROVIDER_PROTOCOL_ERROR'
          ? error
          : providerFailure(
              'AI_PROVIDER_INITIALIZATION_FAILED',
              'Codex app-server initialization failed.',
              undefined,
              error,
            );
        this.#tripFailure(failure);
        throw failure;
      }
    })();
    return this.#initializationPromise;
  }

  #startProcess() {
    this.#assertUsable();
    if (this.#child) return;

    let child;
    try {
      child = this.#spawnProcess(this.#executable, [...this.#argsPrefix, 'app-server', '--listen', 'stdio://'], {
        cwd: this.#cwd,
        env: this.#env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = providerFailure(
        'AI_PROVIDER_SPAWN_ERROR',
        `Failed to spawn Codex app-server: ${error.message}`,
        undefined,
        error,
      );
      this.#tripFailure(failure);
      throw failure;
    }

    this.#child = child;
    const onStdoutData = chunk => {
      this.#stdoutBuffer += chunk.toString('utf8');
      const lines = this.#stdoutBuffer.split(/\r?\n/);
      this.#stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        this.#processingQueue = this.#processingQueue
          .then(() => this.#processLine(line))
          .catch(error => this.#tripFailure(error));
      }
    };
    const onStderrData = chunk => {
      const text = chunk.toString('utf8');
      this.#stderr = `${this.#stderr}${text}`.slice(-this.#maxStderrBytes);
      this.#rawCapture.recordRawEvent({
        sessionId: null,
        stream: 'stderr',
        rawText: text,
      });
    };
    const onError = error => {
      this.#tripFailure(providerFailure(
        'AI_PROVIDER_PROCESS_ERROR',
        `Codex app-server process error: ${error.message}`,
        this.#stderrDetails(),
        error,
      ));
    };
    const onExit = (code, signal) => {
      if (this.#disposed) return;
      this.#tripFailure(providerFailure(
        'AI_PROVIDER_EXIT_ERROR',
        `Codex app-server exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`,
        this.#stderrDetails(),
      ));
    };

    this.#listeners = { onStdoutData, onStderrData, onError, onExit };
    child.stdout?.on('data', onStdoutData);
    child.stderr?.on('data', onStderrData);
    child.on?.('error', onError);
    child.on?.('exit', onExit);
  }

  #stderrDetails() {
    const stderr = this.#stderr.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    return stderr ? { stderr } : undefined;
  }

  #sendRequest(method, params) {
    this.#assertUsable();
    const id = `nevo-${this.#nextRequestId++}`;
    const threadId = params?.threadId || null;
    const turnId = params?.turnId || null;
    return new Promise((resolve, reject) => {
      this.#pendingRequests.set(id, {
        method,
        params,
        threadId,
        turnId,
        resolve,
        reject,
        sentAt: new Date().toISOString(),
      });
      try {
        this.#writeEnvelope({ method, params, id });
      } catch (error) {
        this.#pendingRequests.delete(id);
        const failure = error instanceof AiError
          ? error
          : providerFailure('AI_PROVIDER_WRITE_ERROR', 'Failed to write to Codex app-server.', undefined, error);
        this.#tripFailure(failure);
      }
    });
  }

  #writeEnvelope(envelope) {
    this.#assertUsable();
    const stdin = this.#child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      throw providerFailure('AI_PROVIDER_WRITE_ERROR', 'Codex app-server stdin is not writable.');
    }

    if (own(envelope, 'method')) {
      const requestId = envelope.id !== undefined ? envelope.id : null;
      const threadId = envelope.params?.threadId || null;
      const turnId = envelope.params?.turnId || null;
      this.#rawCapture.recordRawEvent({
        sessionId: threadId,
        turnId,
        requestId,
        stream: 'stdin',
        raw: envelope,
      });
    } else if (own(envelope, 'id')) {
      const serverRequestId = envelope.id;
      const serverReq = this.#activeServerRequests.get(serverRequestId);
      const threadId = serverReq?.threadId || null;
      const turnId = serverReq?.turnId || null;
      this.#activeServerRequests.delete(serverRequestId);
      this.#rawCapture.recordRawEvent({
        sessionId: threadId,
        turnId,
        serverRequestId,
        stream: 'stdin',
        raw: envelope,
      });
    } else {
      this.#rawCapture.recordRawEvent({
        sessionId: null,
        stream: 'stdin',
        raw: envelope,
      });
    }

    stdin.write(`${JSON.stringify(envelope)}\n`);
  }

  async #processLine(line) {
    if (!line.trim()) return;

    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch {
      this.#rawCapture.recordRawEvent({
        sessionId: null,
        stream: 'stdout',
        rawText: line,
      });
      if (!this.#failure && !this.#disposed) {
        throw protocolError('Codex app-server emitted malformed JSON.');
      }
      return;
    }
    if (!isObject(envelope)) {
      this.#rawCapture.recordRawEvent({
        sessionId: null,
        stream: 'stdout',
        rawText: line,
      });
      if (!this.#failure && !this.#disposed) {
        throw protocolError('Codex app-server envelope must be an object.');
      }
      return;
    }
    if (own(envelope, 'jsonrpc') && envelope.jsonrpc !== '2.0') {
      this.#rawCapture.recordRawEvent({
        sessionId: null,
        stream: 'stdout',
        raw: envelope,
      });
      if (!this.#failure && !this.#disposed) {
        throw protocolError("Codex app-server envelope has an invalid 'jsonrpc' member.");
      }
      return;
    }

    const hasMethod = own(envelope, 'method');
    const hasId = own(envelope, 'id');
    const hasResult = own(envelope, 'result');
    const hasError = own(envelope, 'error');

    if (hasMethod) {
      if (typeof envelope.method !== 'string' || envelope.method.length === 0) {
        if (!this.#failure && !this.#disposed) {
          throw protocolError('Codex app-server method must be a non-empty string.');
        }
        return;
      }
      if (!this.#failure && !this.#disposed) {
        validateParams(envelope.params, envelope.method);
      }
      if (hasResult || hasError) {
        if (!this.#failure && !this.#disposed) {
          throw protocolError('Codex method envelope cannot contain result or error.');
        }
        return;
      }
      if (hasId) {
        if (!validateRequestId(envelope.id)) {
          if (!this.#failure && !this.#disposed) {
            throw protocolError('Codex server request has an invalid id.');
          }
          return;
        }
        const serverRequestId = envelope.id;
        const threadId = envelope.params?.threadId || null;
        const turnId = envelope.params?.turnId || envelope.params?.turn?.id || null;
        this.#activeServerRequests.set(serverRequestId, {
          method: envelope.method,
          threadId,
          turnId,
        });
        this.#rawCapture.recordRawEvent({
          sessionId: threadId,
          turnId,
          serverRequestId,
          stream: 'stdout',
          raw: envelope,
        });
        if (!this.#failure && !this.#disposed) {
          await this.#dispatchServerRequest(envelope);
        }
      } else {
        const threadId = envelope.params?.threadId || null;
        const turnId = envelope.params?.turnId || envelope.params?.turn?.id || null;
        this.#rawCapture.recordRawEvent({
          sessionId: threadId,
          turnId,
          stream: 'stdout',
          raw: envelope,
        });
        if (!this.#failure && !this.#disposed) {
          await this.#dispatchNotification(envelope);
        }
      }
      return;
    }

    if (!hasId || !validateRequestId(envelope.id) || hasResult === hasError) {
      this.#rawCapture.recordRawEvent({
        sessionId: null,
        stream: 'stdout',
        raw: envelope,
      });
      if (!this.#failure && !this.#disposed) {
        throw protocolError('Codex response must have a valid id and exactly one of result or error.');
      }
      return;
    }
    const id = String(envelope.id);
    const pending = this.#pendingRequests.get(id);
    if (!pending) {
      this.#rawCapture.recordRawEvent({
        sessionId: null,
        requestId: envelope.id,
        stream: 'stdout',
        raw: envelope,
      });
      if (!this.#failure && !this.#disposed) {
        throw protocolError(`Codex response has an unknown or duplicate id '${id}'.`);
      }
      return;
    }
    this.#pendingRequests.delete(id);

    if (pending.method === 'thread/start' && envelope.result?.thread?.id) {
      const allocatedThreadId = envelope.result.thread.id;
      this.#rawCapture.recordRawEvent({
        sessionId: allocatedThreadId,
        requestId: envelope.id,
        stream: 'stdin',
        backfill: true,
        raw: { method: 'thread/start', params: pending.params, id: envelope.id },
      });
      this.#rawCapture.recordRawEvent({
        sessionId: allocatedThreadId,
        requestId: envelope.id,
        stream: 'stdout',
        raw: envelope,
      });
    } else {
      const sessionId = pending.threadId || null;
      const turnId = pending.turnId || envelope.result?.turn?.id || null;
      this.#rawCapture.recordRawEvent({
        sessionId,
        turnId,
        requestId: envelope.id,
        stream: 'stdout',
        raw: envelope,
      });
    }

    if (this.#failure || this.#disposed) return;

    if (hasError) {
      if (!isObject(envelope.error)) throw protocolError('Codex response error must be an object.');
      pending.reject(new AiError(
        'AI_PROVIDER_REQUEST_ERROR',
        typeof envelope.error.message === 'string' ? envelope.error.message : `Codex '${pending.method}' request failed.`,
        {
          status: 502,
          details: {
            method: pending.method,
            ...(envelope.error.code === undefined ? {} : { providerCode: envelope.error.code }),
          },
        },
      ));
      return;
    }
    pending.resolve(envelope.result);
  }

  async #dispatchNotification(envelope) {
    const notification = Object.freeze({
      method: envelope.method,
      params: envelope.params ?? {},
    });

    for (const waiter of [...this.#waiters]) {
      let matches;
      try {
        matches = waiter.predicate(notification);
      } catch (error) {
        waiter.reject(error);
        throw error;
      }
      if (matches) waiter.resolve(notification);
    }
    for (const handler of this.#notificationSubscribers) {
      await handler(notification);
    }
  }

  async #dispatchServerRequest(envelope) {
    if (this.#serverRequestSubscribers.size === 0) {
      this.#writeServerError(envelope.id, -32601, `Unsupported Codex server request '${envelope.method}'.`);
      throw protocolError(`Unhandled Codex server request '${envelope.method}'.`);
    }

    let answered = false;
    const respond = result => {
      if (answered) throw protocolError(`Codex server request '${envelope.id}' was answered more than once.`);
      answered = true;
      this.#writeEnvelope({ id: envelope.id, result });
    };
    const reject = error => {
      if (answered) throw protocolError(`Codex server request '${envelope.id}' was answered more than once.`);
      answered = true;
      const normalized = isObject(error)
        ? error
        : { code: -32603, message: typeof error === 'string' ? error : 'Codex server request failed.' };
      this.#writeEnvelope({ id: envelope.id, error: normalized });
    };
    const request = Object.freeze({
      method: envelope.method,
      params: envelope.params ?? {},
      respond,
      reject,
    });

    try {
      for (const handler of this.#serverRequestSubscribers) {
        const result = await handler(request);
        if (result !== undefined && !answered) respond(result);
        if (answered) break;
      }
    } catch (error) {
      if (!answered) {
        answered = true;
        this.#writeServerError(envelope.id, -32603, 'Codex server request handler failed.');
      }
      throw error;
    }
    if (!answered) {
      this.#writeServerError(envelope.id, -32603, 'Codex server request handler did not answer.');
      throw protocolError(`Codex server request '${envelope.id}' was not answered.`);
    }
  }

  #writeServerError(id, code, message) {
    this.#writeEnvelope({ id, error: { code, message } });
  }

  #tripFailure(error) {
    if (this.#failure) return this.#failure;
    const failure = error instanceof AiError
      ? error
      : providerFailure('AI_PROVIDER_PROTOCOL_ERROR', 'Codex app-server client failed.', undefined, error);
    this.#failure = failure;
    for (const pending of this.#pendingRequests.values()) pending.reject(failure);
    this.#pendingRequests.clear();
    for (const waiter of [...this.#waiters]) waiter.reject(failure);
    return failure;
  }

  #removeProcessListeners() {
    if (!this.#child || !this.#listeners) return;
    const { onStdoutData, onStderrData, onError, onExit } = this.#listeners;
    this.#child.stdout?.removeListener?.('data', onStdoutData);
    this.#child.stderr?.removeListener?.('data', onStderrData);
    this.#child.removeListener?.('error', onError);
    this.#child.removeListener?.('exit', onExit);
    this.#listeners = null;
  }
}

export function createCodexAppServerClient(options = {}) {
  return new CodexAppServerClient(options);
}
