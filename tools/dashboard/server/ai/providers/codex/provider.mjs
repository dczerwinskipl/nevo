import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AiError, AiValidationError, validateAgentExecutionMode } from '../../contracts.mjs';
import { createCodexAppServerClient, resolveCodexCommand } from './app-server-client.mjs';
import { RawCaptureRecorder, rawCaptureSessionDirectory } from '../raw-capture.mjs';

export { rawCaptureSessionDirectory };

export const CODEX_CAPABILITIES = Object.freeze({
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: false,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
  steerTurn: false,
  planUpdates: false,
});

export const CODEX_DESCRIPTOR = Object.freeze({
  id: 'codex',
  label: 'OpenAI Codex',
  enabled: true,
  capabilities: CODEX_CAPABILITIES,
  supportedModes: ['ask', 'edit', 'agent'],
  defaultMode: 'edit',
});

const TOOL_TYPES = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall']);
const AGENT_MESSAGE_PHASES = new Set(['commentary', 'final_answer']);

function protocolError(message, details) {
  return new AiError('AI_PROVIDER_PROTOCOL_ERROR', message, { status: 502, details });
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw protocolError(`Codex ${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw protocolError(`Codex ${label} must be a non-empty string.`);
  }
  return value;
}

function optionalAgentMessagePhase(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !AGENT_MESSAGE_PHASES.has(value)) {
    throw protocolError(`Codex ${label} has unsupported phase '${String(value)}'.`);
  }
  return value;
}

function modeSettings(mode, cwd) {
  switch (validateAgentExecutionMode(mode)) {
    case 'ask':
      return {
        thread: { approvalPolicy: 'never', sandbox: 'read-only' },
        turn: { approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } },
      };
    case 'agent':
      return {
        thread: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
        turn: {
          approvalPolicy: 'on-request',
          sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false },
        },
      };
    default:
      return {
        thread: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
        turn: {
          approvalPolicy: 'on-request',
          sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false },
        },
      };
  }
}

export function defaultProbeCodexExecutable(executable = 'codex') {
  try {
    const command = resolveCodexCommand(executable);
    const result = spawnSync(command.executable, [...command.argsPrefix, '--version'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 1_500,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

export function mapCodexCommandActions(actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((act, index) => {
      if (!act || typeof act !== 'object') return null;
      const actionType = String(act.type || act.kind || 'other').toLowerCase();
      let kind = 'other';
      let title = act.title || act.command || act.path || `Action ${index + 1}`;
      let target = act.target || act.path || act.file || act.url || undefined;
      let description = act.description || undefined;

      if (['read', 'readfile', 'fileread'].includes(actionType)) {
        kind = 'read';
        title = act.title || (act.path ? `Read ${act.path}` : 'Read file');
        target = act.path || act.target;
      } else if (['write', 'writefile', 'filewrite'].includes(actionType)) {
        kind = 'write';
        title = act.title || (act.path ? `Write ${act.path}` : 'Write file');
        target = act.path || act.target;
      } else if (['edit', 'fileedit', 'modify'].includes(actionType)) {
        kind = 'edit';
        title = act.title || (act.path ? `Edit ${act.path}` : 'Edit file');
        target = act.path || act.target;
      } else if (['list', 'listfiles', 'dirlist', 'ls'].includes(actionType)) {
        kind = 'list';
        title = act.title || (act.path ? `List ${act.path}` : 'List directory');
        target = act.path || act.target;
      } else if (['search', 'filesearch', 'grep', 'find'].includes(actionType)) {
        kind = 'search';
        title =
          act.title || (act.pattern ? `Search for ${act.pattern}` : act.query ? `Search for ${act.query}` : 'Search');
        target = act.target || act.path || act.pattern || act.query;
      } else if (['execute', 'command', 'exec', 'unknown'].includes(actionType)) {
        kind = actionType === 'unknown' ? 'other' : 'execute';
        title = act.title || act.command || 'Execute command';
        target = act.command || act.target;
      } else if (['fetch', 'web', 'download'].includes(actionType)) {
        kind = 'fetch';
        title = act.title || (act.url ? `Fetch ${act.url}` : 'Fetch URL');
        target = act.url || act.target;
      } else if (['other', 'custom'].includes(actionType)) {
        kind = 'other';
        title = act.title || act.command || 'Tool action';
      }

      return {
        id: act.id || `act-${index + 1}`,
        seq: index + 1,
        kind,
        title: String(title).slice(0, 200),
        ...(target ? { target: String(target).slice(0, 1000) } : {}),
        ...(description ? { description: String(description).slice(0, 1000) } : {}),
        ...(act.status ? { status: act.status } : {}),
      };
    })
    .filter(Boolean);
}

// `description` is a concise UI label (C5); the canonical model bounds it to 1000
// chars. The full, untruncated value already survives separately in `input` (an
// expandable technical detail, not length-limited) — a long shell command must only
// truncate the label, never fail the whole Turn's canonical validation.
const MAX_TOOL_DESCRIPTION_LENGTH = 300;

function truncateToolDescription(value) {
  if (typeof value !== 'string') return undefined;
  return value.length > MAX_TOOL_DESCRIPTION_LENGTH ? `${value.slice(0, MAX_TOOL_DESCRIPTION_LENGTH - 1)}…` : value;
}

export function toolDescription(item) {
  switch (item.type) {
    case 'commandExecution': {
      const actions = mapCodexCommandActions(item.commandActions);
      return {
        toolName: 'Command',
        kind: 'command',
        title: 'Run command',
        description: truncateToolDescription(item.command || undefined),
        input: { command: item.command, cwd: item.cwd },
        actions,
      };
    }
    case 'fileChange':
      return {
        toolName: 'File change',
        kind: 'edit',
        title: 'Edit file',
        description: truncateToolDescription(
          Array.isArray(item.changes) ? item.changes.map((c) => c.path).join(', ') : undefined,
        ),
        input: { changes: item.changes },
      };
    case 'mcpToolCall':
      return {
        toolName: `${item.server}/${item.tool}`,
        kind: 'other',
        title: item.title || `${item.server}/${item.tool}`,
        description: `${item.server}/${item.tool}`,
        input: { server: item.server, tool: item.tool, arguments: item.arguments },
      };
    case 'dynamicToolCall':
      return {
        toolName: item.tool,
        kind: 'other',
        title: item.title || item.tool,
        description: item.tool,
        input: { tool: item.tool, arguments: item.arguments },
      };
    default:
      return null;
  }
}

function toolOutput(item) {
  switch (item.type) {
    case 'commandExecution': {
      const actions = mapCodexCommandActions(item.commandActions);
      return {
        output: item.aggregatedOutput ?? '',
        ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {}),
        ...(actions.length > 0 ? { actions } : {}),
      };
    }
    case 'fileChange':
      return { changes: item.changes };
    case 'mcpToolCall':
      return item.error ? { error: item.error } : { result: item.result };
    case 'dynamicToolCall':
      return { contentItems: item.contentItems ?? [], success: item.success };
    default:
      return {};
  }
}

function isToolSuccess(item) {
  if (item.type === 'dynamicToolCall' && typeof item.success === 'boolean') return item.success;
  return item.status === 'completed';
}

function permissionInteraction(method, params) {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return {
        kind: 'permission',
        toolName: 'Command',
        input: { command: params.command, cwd: params.cwd },
        ...(params.reason ? { details: String(params.reason) } : {}),
      };
    case 'item/fileChange/requestApproval':
      return {
        kind: 'permission',
        toolName: 'File change',
        input: { ...(params.grantRoot ? { grantRoot: params.grantRoot } : {}) },
        ...(params.reason ? { details: String(params.reason) } : {}),
      };
    case 'item/permissions/requestApproval':
      return {
        kind: 'permission',
        toolName: 'Additional permissions',
        input: { permissions: structuredClone(params.permissions ?? {}), cwd: params.cwd },
        ...(params.reason ? { details: String(params.reason) } : {}),
      };
    default:
      return null;
  }
}

export class CodexAgentProvider {
  #client;
  #cwd;
  #executable;
  #probeExecutable;
  #availabilityCache = { checkedAt: 0, result: null };
  #loadedThreads = new Set();
  #operationsByThread = new Map();
  #interactions = new Map();
  #disposed = false;
  #disposePromise = null;
  #unsubscribeNotification;
  #unsubscribeServerRequest;
  #rawCapture;

  constructor({
    executable = 'codex',
    cwd = process.cwd(),
    client,
    clientFactory = createCodexAppServerClient,
    probeExecutable,
    rawCaptureDir = null,
    rawCaptureEnabled = false,
    rawFlushTimeoutMs = 2_000,
  } = {}) {
    this.#executable = executable;
    this.#cwd = cwd;
    this.#rawCapture =
      client?.rawCapture ??
      new RawCaptureRecorder({
        providerId: 'codex',
        rawCaptureDir: rawCaptureEnabled
          ? rawCaptureDir || resolve(this.#cwd, '.nevo-ai-local', 'codex_raw')
          : rawCaptureDir
            ? resolve(rawCaptureDir)
            : null,
        rawCaptureEnabled,
        rawFlushTimeoutMs,
      });
    this.#client =
      client ??
      clientFactory({
        executable,
        cwd,
        rawCaptureDir,
        rawCaptureEnabled,
        rawFlushTimeoutMs,
        rawCaptureRecorder: this.#rawCapture,
      });
    this.#probeExecutable = probeExecutable ?? (client ? () => true : defaultProbeCodexExecutable);
    this.#unsubscribeNotification = this.#client.onNotification((notification) =>
      this.#handleNotification(notification),
    );
    this.#unsubscribeServerRequest = this.#client.onServerRequest((request) => this.#handleServerRequest(request));
    this.descriptor = CODEX_DESCRIPTOR;
  }

  getRawCapturePath(sessionId) {
    return this.#rawCapture.getRawCapturePath(sessionId);
  }

  async flushRawCapture(sessionId) {
    return this.#rawCapture.flushRawCapture(sessionId);
  }

  isAvailable({ ttlMs = 30_000 } = {}) {
    const now = Date.now();
    if (this.#availabilityCache.result && now - this.#availabilityCache.checkedAt < ttlMs) {
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
      : {
          available: false,
          unavailableReason: `OpenAI Codex CLI ('${this.#executable}') is not found in PATH. Install Codex CLI to enable this provider.`,
        };
    this.#availabilityCache = { checkedAt: now, result };
    return result;
  }

  async createSession({ mode = 'edit' } = {}) {
    this.#assertUsable();
    return { providerSessionId: await this.#startThread(mode) };
  }

  async startTurn({
    turnId,
    providerSessionId,
    setProviderSessionId,
    message,
    prompt,
    mode = 'edit',
    setOperation,
    emitCommentaryDelta,
    emitReasoningDelta,
    emitFinalAnswerDelta,
    setFinalAnswer,
    emitToolStarted,
    emitToolUpdated,
    emitToolCompleted,
    addToolAction,
    emitUsageUpdated,
    emitEvent,
    requestInteraction,
  } = {}) {
    this.#assertUsable();
    const input = message ?? prompt;
    if (typeof input !== 'string' || input.length === 0) {
      throw new AiValidationError('A valid message/prompt is required.');
    }
    const validatedMode = validateAgentExecutionMode(mode);
    let threadId = providerSessionId;
    if (!threadId) {
      threadId = await this.#startThread(validatedMode);
      if (setProviderSessionId) await setProviderSessionId(threadId);
    } else {
      await this.#ensureThreadLoaded(threadId, validatedMode);
    }

    this.#rawCapture.logCapturePathOnce(threadId);

    if (this.#operationsByThread.has(threadId)) {
      throw new AiError('AI_TURN_CONFLICT', 'Codex thread already has an active turn.', { status: 409 });
    }

    const operation = this.#createOperation({
      turnId,
      threadId,
      emitCommentaryDelta,
      emitReasoningDelta,
      emitFinalAnswerDelta,
      setFinalAnswer,
      emitToolStarted,
      emitToolUpdated,
      emitToolCompleted,
      addToolAction,
      emitUsageUpdated,
      emitEvent,
      requestInteraction,
    });
    this.#operationsByThread.set(threadId, operation);
    setOperation?.(operation);

    const failureWatch = this.#client.waitForNotification(() => false, { signal: operation.watchAbort.signal });
    failureWatch.catch((error) => {
      if (!operation.settled) this.#rejectOperation(operation, error);
    });

    try {
      const settings = modeSettings(validatedMode, this.#cwd).turn;
      const result = requireObject(
        await this.#client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: input }],
          ...settings,
        }),
        'turn/start response',
      );
      const codexTurn = requireObject(result.turn, 'turn/start turn');
      const responseTurnId = requireString(codexTurn.id, 'turn id');
      if (operation.codexTurnId && operation.codexTurnId !== responseTurnId) {
        throw protocolError('Codex turn/start identity does not match the preceding turn/started notification.');
      }
      operation.codexTurnId = responseTurnId;
      if (codexTurn.status !== 'inProgress') {
        throw protocolError(`Codex turn/start returned unexpected status '${codexTurn.status}'.`);
      }
      operation.resolveReady(operation.codexTurnId);
      return await operation.terminalPromise;
    } catch (error) {
      operation.rejectReady(error);
      if (!operation.settled) this.#rejectOperation(operation, error);
      throw error;
    } finally {
      operation.watchAbort.abort();
      this.#operationsByThread.delete(threadId);
      this.#clearOperationInteractions(operation);
      await this.#rawCapture.flushRawCaptureBounded(threadId);
    }
  }

  async respondInteraction({ turnId, providerSessionId, interactionId, response } = {}) {
    this.#assertUsable();
    const correlation = this.#interactions.get(interactionId);
    if (
      !correlation ||
      correlation.operation.turnId !== turnId ||
      correlation.operation.threadId !== providerSessionId
    ) {
      throw new AiError('AI_NOT_FOUND', 'The Codex interaction correlation was not found.', { status: 404 });
    }
    if (correlation.answered) {
      throw new AiError('AI_NOT_FOUND', 'The Codex interaction was already answered.', { status: 404 });
    }

    const payload = this.#interactionResponse(correlation, response);
    correlation.request.respond(payload);
    correlation.answered = true;
    correlation.release();
    this.#interactions.delete(interactionId);
    correlation.operation.interactionIds.delete(interactionId);
    return { continuesTurn: true, operation: correlation.operation };
  }

  async cancelTurn({ operation } = {}) {
    if (!operation || operation.settled) return { cancelled: true };

    for (const interactionId of [...operation.interactionIds]) {
      const correlation = this.#interactions.get(interactionId);
      if (!correlation || correlation.answered) continue;
      try {
        correlation.request.respond(this.#cancelInteractionResponse(correlation));
      } catch {}
      correlation.answered = true;
      correlation.release();
      this.#interactions.delete(interactionId);
      operation.interactionIds.delete(interactionId);
    }

    if (!operation.codexTurnId) {
      try {
        await operation.readyPromise;
      } catch (error) {
        if (!operation.settled) throw error;
        return { cancelled: true };
      }
    }
    operation.cancelRequested = true;
    try {
      await this.#client.request('turn/interrupt', {
        threadId: operation.threadId,
        turnId: operation.codexTurnId,
      });
    } catch (error) {
      if (!operation.settled) throw error;
    }
    return { cancelled: true };
  }

  dispose() {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    const error = new AiError('AI_PROVIDER_DISPOSED', 'Codex provider was disposed.', { status: 503 });
    for (const operation of this.#operationsByThread.values()) this.#rejectOperation(operation, error);
    this.#unsubscribeNotification?.();
    this.#unsubscribeServerRequest?.();
    this.#disposePromise = Promise.resolve(this.#client.dispose());
    return this.#disposePromise;
  }

  #assertUsable() {
    if (this.#disposed) throw new AiError('AI_PROVIDER_DISPOSED', 'Codex provider was disposed.', { status: 503 });
  }

  async #startThread(mode) {
    const settings = modeSettings(mode, this.#cwd).thread;
    const result = requireObject(
      await this.#client.request('thread/start', {
        cwd: this.#cwd,
        ...settings,
      }),
      'thread/start response',
    );
    const thread = requireObject(result.thread, 'thread/start thread');
    const threadId = requireString(thread.id, 'thread id');
    this.#loadedThreads.add(threadId);
    return threadId;
  }

  async #ensureThreadLoaded(threadId, mode) {
    if (this.#loadedThreads.has(threadId)) return;
    const settings = modeSettings(mode, this.#cwd).thread;
    const result = requireObject(
      await this.#client.request('thread/resume', {
        threadId,
        cwd: this.#cwd,
        ...settings,
      }),
      'thread/resume response',
    );
    const resumed = requireObject(result.thread, 'thread/resume thread');
    if (requireString(resumed.id, 'resumed thread id') !== threadId) {
      throw protocolError('Codex thread/resume returned a different thread identity.');
    }
    this.#loadedThreads.add(threadId);
  }

  #createOperation(values) {
    let resolveTerminal;
    let rejectTerminal;
    let resolveReady;
    let rejectReady;
    const terminalPromise = new Promise((resolve, reject) => {
      resolveTerminal = resolve;
      rejectTerminal = reject;
    });
    const readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    terminalPromise.catch(() => {});
    readyPromise.catch(() => {});
    return {
      ...values,
      codexTurnId: null,
      terminalPromise,
      resolveTerminal,
      rejectTerminal,
      readyPromise,
      resolveReady,
      rejectReady,
      settled: false,
      cancelRequested: false,
      providerError: null,
      itemCounter: 0,
      items: new Map(),
      interactionIds: new Set(),
      watchAbort: new AbortController(),
    };
  }

  #operationFor(params) {
    if (!params || typeof params !== 'object') return null;
    let operation = typeof params.threadId === 'string' ? this.#operationsByThread.get(params.threadId) : null;
    if (!operation && (params.turnId || params.turn?.id)) {
      const targetTurnId = params.turnId || params.turn?.id;
      for (const op of this.#operationsByThread.values()) {
        if (op.codexTurnId === targetTurnId) {
          operation = op;
          break;
        }
      }
    }
    if (!operation && this.#operationsByThread.size === 1) {
      operation = Array.from(this.#operationsByThread.values())[0];
    }
    if (!operation) return null;
    if (params.turnId && operation.codexTurnId && params.turnId !== operation.codexTurnId) return null;
    return operation;
  }

  #handleNotification({ method, params }) {
    const operation = this.#operationFor(params);
    if (!operation) return;

    switch (method) {
      case 'turn/started': {
        const turn = requireObject(params.turn, 'turn/started turn');
        const id = requireString(turn.id, 'turn/started turn id');
        if (operation.codexTurnId && operation.codexTurnId !== id) {
          throw protocolError('Codex turn/started identity does not match turn/start.');
        }
        operation.codexTurnId = id;
        return;
      }
      case 'item/started':
        this.#itemStarted(operation, params);
        return;
      case 'item/agentMessage/delta':
        this.#agentMessageDelta(operation, params);
        return;
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.#reasoningDelta(operation, params);
        return;
      case 'item/completed':
        this.#itemCompleted(operation, params);
        return;
      case 'thread/tokenUsage/updated':
        this.#usageUpdated(operation, params);
        return;
      case 'error':
        if (params.willRetry !== true) operation.providerError = params.error;
        return;
      case 'turn/completed':
        this.#turnCompleted(operation, params);
        return;
      case 'turn/plan/updated':
      case 'item/plan/delta':
      case 'serverRequest/resolved':
      case 'thread/status/changed':
        return;
      default:
        return;
    }
  }

  #itemStarted(operation, params) {
    const item = requireObject(params.item, 'item/started item');
    const id = requireString(item.id, 'item id');
    const type = requireString(item.type, 'item type');
    if (operation.items.has(id)) throw protocolError(`Codex item '${id}' started more than once.`);

    if (type === 'userMessage' || type === 'agentMessage' || type === 'reasoning' || TOOL_TYPES.has(type)) {
      this.#publishSupersededUnphasedMessages(operation);
    }

    if (type === 'userMessage') {
      operation.items.set(id, { type, terminal: false });
      return;
    }
    if (type === 'agentMessage') {
      const publicId = `message-${operation.turnId}-${++operation.itemCounter}`;
      const phase = optionalAgentMessagePhase(item.phase, 'started agent message');
      const state = {
        type,
        publicId,
        progressId: `progress-${operation.turnId}-${operation.itemCounter}`,
        phase,
        streamedText: '',
        finalText: null,
        publishedAs: null,
        superseded: false,
        terminal: false,
      };
      operation.items.set(id, state);
      if (phase) this.#beginAgentMessage(operation, state, phase);
      return;
    }
    if (type === 'reasoning') {
      operation.items.set(id, {
        type,
        publicId: `reasoning-${operation.turnId}-${++operation.itemCounter}`,
        terminal: false,
      });
      return;
    }
    if (TOOL_TYPES.has(type)) {
      const description = toolDescription(item);
      if (!description || typeof description.toolName !== 'string') {
        throw protocolError(`Codex ${type} item has an invalid tool shape.`);
      }
      const publicId = `tool-${operation.turnId}-${++operation.itemCounter}`;
      operation.items.set(id, { type, publicId, terminal: false });
      operation.emitToolStarted?.({ toolId: publicId, ...description });
    }
  }

  #agentMessageDelta(operation, params) {
    const item = operation.items.get(requireString(params.itemId, 'agent message item id'));
    if (!item || item.type !== 'agentMessage' || item.terminal) {
      throw protocolError('Codex agent-message delta does not match an active agent message item.');
    }
    const delta = requireString(params.delta, 'agent message delta');
    item.streamedText += delta;
    if (item.publishedAs === 'final_answer') operation.emitFinalAnswerDelta?.(delta, 'final-answer');
    if (item.publishedAs === 'commentary') operation.emitCommentaryDelta?.(delta, item.publicId);
  }

  #reasoningDelta(operation, params) {
    const item = operation.items.get(requireString(params.itemId, 'reasoning item id'));
    if (!item || item.type !== 'reasoning' || item.terminal) {
      throw protocolError('Codex reasoning delta does not match an active reasoning item.');
    }
    operation.emitReasoningDelta?.(requireString(params.delta, 'reasoning delta'), item.publicId);
  }

  #itemCompleted(operation, params) {
    const finalItem = requireObject(params.item, 'item/completed item');
    const privateId = requireString(finalItem.id, 'completed item id');
    const state = operation.items.get(privateId);
    if (!state) return;
    if (state.terminal) throw protocolError(`Codex item '${privateId}' completed more than once.`);
    if (finalItem.type !== state.type) throw protocolError(`Codex item '${privateId}' changed type at completion.`);
    state.terminal = true;

    if (state.type === 'agentMessage') {
      const finalText = requireString(finalItem.text, 'completed agent message text');
      if (!finalText.startsWith(state.streamedText)) {
        throw protocolError('Codex final agent message conflicts with its emitted deltas.');
      }
      const completedPhase = optionalAgentMessagePhase(finalItem.phase, 'completed agent message');
      if (state.phase && completedPhase && state.phase !== completedPhase) {
        throw protocolError('Codex agent message changed phase at completion.');
      }
      state.phase ??= completedPhase;
      state.finalText = finalText;
      const wasPublished = Boolean(state.publishedAs);
      if (state.phase && !wasPublished) this.#beginAgentMessage(operation, state, state.phase);
      if (!state.phase && state.superseded && !state.publishedAs) {
        this.#beginAgentMessage(operation, state, 'commentary');
      }
      if (wasPublished) {
        const suffix = finalText.slice(state.streamedText.length);
        if (suffix) this.#emitAgentMessageText(operation, state, suffix);
      }
      return;
    }
    if (TOOL_TYPES.has(state.type)) {
      const finalActions = mapCodexCommandActions(finalItem.actions || finalItem.commandActions);
      operation.emitToolCompleted?.({
        toolId: state.publicId,
        output: toolOutput(finalItem),
        ...(typeof finalItem.durationMs === 'number' ? { durationMs: finalItem.durationMs } : {}),
        ...(Array.isArray(finalActions) && finalActions.length > 0 ? { actions: finalActions } : {}),
        status: isToolSuccess(finalItem) ? 'completed' : 'failed',
      });
    }
  }

  #usageUpdated(operation, params) {
    const usage = requireObject(params.tokenUsage, 'token usage');
    const last = requireObject(usage.last, 'last token usage');
    if (!Number.isFinite(last.inputTokens) || !Number.isFinite(last.outputTokens)) {
      throw protocolError('Codex token usage is missing numeric input/output totals.');
    }
    operation.emitUsageUpdated?.({ tokensIn: last.inputTokens, tokensOut: last.outputTokens });
  }

  #turnCompleted(operation, params) {
    const turn = requireObject(params.turn, 'turn/completed turn');
    if (requireString(turn.id, 'completed turn id') !== operation.codexTurnId) {
      throw protocolError('Codex turn/completed identity does not match the active turn.');
    }
    const status = requireString(turn.status, 'completed turn status');
    if (!['completed', 'failed', 'interrupted'].includes(status)) {
      throw protocolError(`Codex turn/completed reported unknown status '${status}'.`);
    }

    const unfinished = [...operation.items.entries()].filter(([, item]) => !item.terminal);
    for (const [, item] of unfinished.filter(([, item]) => TOOL_TYPES.has(item.type))) {
      item.terminal = true;
      operation.emitToolCompleted?.({
        toolId: item.publicId,
        output: 'No authoritative Codex tool outcome.',
        status: 'failed',
      });
    }

    if (status === 'interrupted') {
      this.#rejectOperation(
        operation,
        new AiError(
          operation.cancelRequested ? 'AI_TURN_CANCELLED' : 'AI_TURN_INTERRUPTED',
          operation.cancelRequested ? 'Codex turn was cancelled.' : 'Codex turn was interrupted.',
          { status: 409 },
        ),
      );
      return;
    }
    if (status === 'failed') {
      this.#rejectOperation(
        operation,
        new AiError(
          'AI_PROVIDER_ERROR',
          turn.error?.message || operation.providerError?.message || 'Codex turn failed.',
          { status: 502 },
        ),
      );
      return;
    }
    if (operation.providerError) {
      this.#rejectOperation(
        operation,
        new AiError('AI_PROVIDER_ERROR', 'Codex reported a terminal provider error.', { status: 502 }),
      );
      return;
    }

    const agentMessages = [...operation.items.entries()].filter(([, item]) => item.type === 'agentMessage');
    const lastAgentMessageId = agentMessages.at(-1)?.[0];
    const unsafe = unfinished.find(
      ([privateId, item]) =>
        TOOL_TYPES.has(item.type) ||
        (item.type === 'agentMessage' && item.phase === 'final_answer') ||
        (item.type === 'agentMessage' && !item.phase && privateId === lastAgentMessageId),
    );
    if (unsafe) {
      const [privateId, item] = unsafe;
      const phase = item.type === 'agentMessage' ? (item.phase ?? null) : undefined;
      const phaseLabel = phase ? ` (${phase})` : '';
      this.#rejectOperation(
        operation,
        protocolError(
          `Codex completed turn '${operation.codexTurnId}' with unfinished ${item.type}${phaseLabel} item '${privateId}'.`,
          {
            codexTurnId: operation.codexTurnId,
            turnStatus: status,
            itemId: privateId,
            itemType: item.type,
            ...(item.type === 'agentMessage' ? { agentMessagePhase: phase } : {}),
          },
        ),
      );
      return;
    }

    this.#publishTerminalUnphasedMessages(operation);
    this.#resolveOperation(operation);
  }

  #beginAgentMessage(operation, state, phase) {
    if (state.publishedAs && state.publishedAs !== phase) {
      throw protocolError('Codex agent message cannot be published under two phases.');
    }
    if (state.publishedAs) return;
    state.publishedAs = phase;
    if (phase === 'final_answer') {
      operation.emitEvent?.('message.started', { messageId: state.publicId, role: 'assistant' });
    }
    const text = state.finalText ?? state.streamedText;
    if (text) this.#emitAgentMessageText(operation, state, text);
  }

  #emitAgentMessageText(operation, state, text) {
    if (state.publishedAs === 'final_answer') operation.emitFinalAnswerDelta?.(text, 'final-answer');
    else operation.emitCommentaryDelta?.(text, state.publicId);
  }

  #publishSupersededUnphasedMessages(operation) {
    for (const state of operation.items.values()) {
      if (state.type === 'agentMessage' && !state.phase && !state.publishedAs) {
        state.superseded = true;
        if (state.terminal) this.#beginAgentMessage(operation, state, 'commentary');
      }
    }
  }

  #publishTerminalUnphasedMessages(operation) {
    const pending = [...operation.items.values()].filter(
      (state) => state.type === 'agentMessage' && state.terminal && !state.phase && !state.publishedAs,
    );
    const hasFinalAnswer = [...operation.items.values()].some(
      (state) => state.type === 'agentMessage' && state.publishedAs === 'final_answer',
    );
    for (let index = 0; index < pending.length; index += 1) {
      const isLegacyFinal = !hasFinalAnswer && index === pending.length - 1;
      this.#beginAgentMessage(operation, pending[index], isLegacyFinal ? 'final_answer' : 'commentary');
    }
  }

  async #handleServerRequest(request) {
    const params = requireObject(request.params, `${request.method} params`);
    const operation = this.#operationFor(params);
    if (!operation || !operation.requestInteraction) {
      request.reject({ code: -32602, message: 'No matching active Codex turn.' });
      if (operation) this.#rejectOperation(operation, protocolError('Codex server request could not be correlated.'));
      return;
    }

    let neutral = permissionInteraction(request.method, params);
    let providerQuestionIds = null;
    if (request.method === 'item/tool/requestUserInput') {
      if (!Array.isArray(params.questions) || params.questions.length === 0) {
        request.reject({ code: -32602, message: 'Codex user-input request has no questions.' });
        this.#rejectOperation(operation, protocolError('Codex user-input request has no questions.'));
        return;
      }
      providerQuestionIds = params.questions.map((question) => requireString(question.id, 'user-input question id'));
      neutral = {
        kind: 'question',
        questions: params.questions.map((question) => ({
          question: requireString(question.question, 'user-input question'),
          ...(question.header ? { header: String(question.header) } : {}),
          ...(Array.isArray(question.options)
            ? {
                options: question.options.map((option) => ({
                  label: String(option.label),
                  description: String(option.description),
                })),
              }
            : {}),
          multiSelect: false,
        })),
      };
    }
    if (!neutral) {
      request.reject({ code: -32601, message: `Unsupported Codex server request '${request.method}'.` });
      this.#rejectOperation(operation, protocolError(`Unsupported Codex server request '${request.method}'.`));
      return;
    }

    const interaction = await operation.requestInteraction(neutral, { resumePolicy: 'live-operation' });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const correlation = {
      operation,
      request,
      method: request.method,
      interaction,
      providerQuestionIds,
      requestedPermissions: params.permissions,
      answered: false,
      release,
    };
    this.#interactions.set(interaction.id, correlation);
    operation.interactionIds.add(interaction.id);
    await gate;
  }

  #interactionResponse(correlation, response) {
    if (correlation.method === 'item/tool/requestUserInput') {
      const byQuestion = new Map(response.answers.map((answer) => [answer.questionId, answer.value]));
      const answers = {};
      correlation.interaction.questions.forEach((question, index) => {
        const value = byQuestion.get(question.id);
        answers[correlation.providerQuestionIds[index]] = { answers: Array.isArray(value) ? value : [value] };
      });
      return { answers };
    }
    if (correlation.method === 'item/permissions/requestApproval') {
      return response.decision === 'allow'
        ? { permissions: structuredClone(correlation.requestedPermissions ?? {}), scope: 'turn' }
        : { permissions: {}, scope: 'turn' };
    }
    return { decision: response.decision === 'allow' ? 'accept' : 'decline' };
  }

  #cancelInteractionResponse(correlation) {
    if (correlation.method === 'item/tool/requestUserInput') {
      return {
        answers: Object.fromEntries(correlation.providerQuestionIds.map((id) => [id, { answers: [] }])),
      };
    }
    if (correlation.method === 'item/permissions/requestApproval') {
      return { permissions: {}, scope: 'turn' };
    }
    return { decision: 'decline' };
  }

  #resolveOperation(operation) {
    if (operation.settled) return;
    operation.settled = true;
    operation.resolveTerminal({ operation, providerSessionId: operation.threadId });
  }

  #rejectOperation(operation, error) {
    if (operation.settled) return;
    operation.settled = true;
    operation.rejectTerminal(error instanceof Error ? error : protocolError('Codex turn failed.'));
  }

  #clearOperationInteractions(operation) {
    for (const interactionId of [...operation.interactionIds]) {
      const correlation = this.#interactions.get(interactionId);
      if (correlation && !correlation.answered) {
        try {
          correlation.request.reject({ code: -32603, message: 'Codex turn ended before the request was answered.' });
        } catch {}
        correlation.release();
      }
      this.#interactions.delete(interactionId);
      operation.interactionIds.delete(interactionId);
    }
  }
}

export function createCodexAgentProvider(options = {}) {
  return new CodexAgentProvider(options);
}
