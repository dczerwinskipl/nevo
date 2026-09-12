import { spawn, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { AiError, AiValidationError, validateAgentExecutionMode } from '../../contracts.mjs';
import { createAgentModelDescriptor } from '../../model/model-catalog.mjs';
import { createClaudeContinuationStore } from './continuation-store.mjs';
import { terminateChildProcess, getProcessTreeSpawnOptions } from '../process-termination.mjs';
import { RawCaptureRecorder, rawCaptureSessionDirectory } from '../raw-capture.mjs';
import { mcpInteractionRegistry } from '../../interactions/mcp/index.mjs';

export { rawCaptureSessionDirectory };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOOK_SCRIPT_PATH = join(__dirname, 'hook.mjs');

export const CLAUDE_CAPABILITIES = Object.freeze({
  interactivePermissions: false,
  interactiveQuestions: true,
  interactiveConfirmations: false,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  reasoningEvents: true,
  canOverrideTurnModel: true,
  usage: true,
});

// Curated identity/display metadata only (D1/Area 03): no `isDefault` is asserted for any
// entry, and no `traits` are invented — this codebase has no authoritative evidence (CLI
// documentation, `--help` output, or operator configuration) of these models' reasoning,
// vision, or context-window characteristics, so traits stay genuinely unknown rather than
// guessed. Re-verified against the installed Claude CLI's `--model` help text, which
// confirms only the current naming scheme (`claude-<family>-<version>`, e.g.
// `claude-fable-5`) and family aliases (`fable`, `opus`, `sonnet`) — it does not expose an
// exhaustive model list, so these IDs come from Anthropic's own current-model guidance for
// this environment, not from guessing.
export const CLAUDE_CURATED_MODELS = Object.freeze([
  Object.freeze({ id: 'claude-opus-5', label: 'Claude Opus 5', source: 'known' }),
  Object.freeze({ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', source: 'known' }),
  Object.freeze({ id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', source: 'known' }),
]);

export function mapClaudeError(rawError, fallbackMessage = 'Claude turn failed.', exitCode = null) {
  const message =
    typeof rawError === 'string'
      ? rawError
      : rawError?.message
        ? String(rawError.message)
        : fallbackMessage;

  const details = {
    ...(exitCode !== null ? { exitCode } : {}),
    ...(rawError && typeof rawError === 'object' && rawError.code ? { providerCode: rawError.code } : {}),
  };

  const statusNumber =
    typeof rawError === 'object' && rawError !== null
      ? typeof rawError.status === 'number'
        ? rawError.status
        : typeof rawError.code === 'number'
          ? rawError.code
          : null
      : null;

  if (/timeout|timed out|deadline exceeded|ETIMEDOUT/i.test(message) || exitCode === 124) {
    return new AiError('AI_PROVIDER_TIMEOUT', message, {
      status: 504,
      recoveryHint: 'none',
      details,
    });
  }

  if (/unauthorized|auth|credentials|login|api key|authentication failed|not logged in/i.test(message)) {
    return new AiError('AI_AUTH_FAILED', message, {
      status: 401,
      recoveryHint: 'operator-action',
      details,
    });
  }

  if (/forbidden|permission denied|sandbox|policy denied/i.test(message)) {
    return new AiError('AI_POLICY_DENIED', message, {
      status: 403,
      recoveryHint: 'operator-action',
      details,
    });
  }

  if (/quota|credit|billing|monthly limit|plan limit/i.test(message)) {
    return new AiError('AI_QUOTA_EXHAUSTED', message, {
      status: 429,
      recoveryHint: 'alternate-provider',
      details,
    });
  }

  if (statusNumber === 429 || /rate limit|too many requests|tpm|rpm/i.test(message)) {
    return new AiError('AI_RATE_LIMITED', message, {
      status: 429,
      recoveryHint: 'retry-after-delay',
      details,
    });
  }

  if (/protocol error|malformed json|unexpected token/i.test(message)) {
    return new AiError('AI_PROTOCOL_ERROR', message, {
      status: 502,
      recoveryHint: 'new-session',
      details,
    });
  }

  if (rawError?.code === 'ENOENT' || /ENOENT|not found in PATH/i.test(message)) {
    return new AiError('AI_PROVIDER_UNAVAILABLE', message, {
      status: 503,
      recoveryHint: 'operator-action',
      details,
    });
  }

  return new AiError('AI_PROVIDER_EXECUTION_ERROR', message, {
    status: 502,
    recoveryHint: 'new-turn',
    details,
  });
}

// `description` is a concise label for primary UI presentation (C5) — the canonical
// model bounds it to 1000 chars, and the full untruncated value already survives
// separately in `input` (an expandable technical detail, not length-limited). A raw
// shell command, heredoc, or long search pattern can easily exceed that, which
// previously failed the entire Turn's canonical validation instead of just the label.
const MAX_TOOL_DESCRIPTION_LENGTH = 300;

function truncateToolDescription(value) {
  if (typeof value !== 'string') return undefined;
  return value.length > MAX_TOOL_DESCRIPTION_LENGTH ? `${value.slice(0, MAX_TOOL_DESCRIPTION_LENGTH - 1)}…` : value;
}

export function mapClaudeTool(toolName = '', input = {}) {
  const name = String(toolName || '').trim();
  const lower = name.toLowerCase();

  function extractFileBasename(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) return undefined;
    const normalized = filePath.trim().replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : filePath.trim();
  }

  function extractCommandSubject(cmd) {
    if (typeof cmd !== 'string' || !cmd.trim()) return undefined;
    const singleLine = cmd.trim().split('\n')[0].trim();
    if (singleLine.length <= 40) return singleLine;
    return `${singleLine.slice(0, 39)}…`;
  }

  if (['bash', 'terminal', 'executecommand', 'command'].includes(lower)) {
    return {
      kind: 'command',
      title: 'Run command',
      subject: extractCommandSubject(input?.command),
      description: truncateToolDescription(typeof input?.command === 'string' ? input.command : undefined),
    };
  }

  if (['read', 'view', 'notebookread'].includes(lower)) {
    const rawPath =
      typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : undefined;
    return {
      kind: 'read',
      title: 'Read file',
      subject: extractFileBasename(rawPath),
      description: truncateToolDescription(rawPath),
    };
  }

  if (['write', 'createfile'].includes(lower)) {
    const rawPath =
      typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : undefined;
    return {
      kind: 'write',
      title: 'Write file',
      subject: extractFileBasename(rawPath),
      description: truncateToolDescription(rawPath),
    };
  }

  if (['edit', 'multiedit', 'notebookedit', 'fileedit'].includes(lower)) {
    const rawPath =
      typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : undefined;
    return {
      kind: 'edit',
      title: 'Edit file',
      subject: extractFileBasename(rawPath),
      description: truncateToolDescription(rawPath),
    };
  }

  if (['glob', 'ls', 'listdirectory', 'listfiles', 'listdir'].includes(lower)) {
    const rawPath =
      typeof input?.path === 'string' ? input.path : typeof input?.pattern === 'string' ? input.pattern : undefined;
    return {
      kind: 'list',
      title: 'List files',
      subject: typeof input?.pattern === 'string' ? input.pattern : extractFileBasename(rawPath),
      description: truncateToolDescription(rawPath),
    };
  }

  if (['grep', 'search', 'find', 'filesearch'].includes(lower)) {
    const rawSubject =
      typeof input?.pattern === 'string' ? input.pattern : typeof input?.query === 'string' ? input.query : undefined;
    return {
      kind: 'search',
      title: 'Search files',
      subject: rawSubject,
      description: truncateToolDescription(rawSubject || (typeof input?.path === 'string' ? input.path : undefined)),
    };
  }

  if (['websearch', 'webfetch', 'browser', 'fetch'].includes(lower)) {
    const rawSubject =
      typeof input?.query === 'string'
        ? input.query
        : typeof input?.url === 'string'
          ? input.url.replace(/^https?:\/\//, '').split('?')[0]
          : undefined;
    return {
      kind: 'web',
      title: 'Web search / fetch',
      subject: rawSubject,
      description: truncateToolDescription(
        typeof input?.url === 'string' ? input.url : typeof input?.query === 'string' ? input.query : undefined,
      ),
    };
  }

  if (lower.includes('ask_user') || lower.includes('askuserquestion')) {
    const rawQuestion =
      typeof input?.question === 'string'
        ? input.question
        : typeof input?.prompt === 'string'
          ? input.prompt
          : undefined;
    return {
      kind: 'other',
      title: 'Ask question',
      subject: extractCommandSubject(rawQuestion),
      description: truncateToolDescription(rawQuestion),
    };
  }

  return {
    kind: 'other',
    title: name || 'Tool',
    subject: undefined,
    description: undefined,
  };
}

export function defaultProbeClaudeExecutable(executable) {
  try {
    const probe = process.platform === 'win32' ? `where.exe "${executable}"` : `which "${executable}"`;
    execSync(probe, { stdio: 'ignore', timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

export class ClaudeAgentProvider {
  #executable;
  #cwd;
  #spawnProcess;
  #continuationStore;
  #hookScriptPath;
  #materializedSessions = new Set();
  #availabilityCache = { checkedAt: 0, result: null };
  #cancelGraceMs;
  #forceGraceMs;
  #probeExecutable;
  #rawCapture;
  #mcpEnabled;
  #mcpEndpointUrl;
  #tlsCertPath;
  #configuredModels = [];

  constructor({
    executable = 'claude',
    cwd = process.cwd(),
    spawnProcess = spawn,
    continuationStore = createClaudeContinuationStore({
      baseDir: join(cwd, '.nevo-ai-local', 'transcripts', 'claude', 'continuations'),
    }),
    hookScriptPath = HOOK_SCRIPT_PATH,
    cancelGraceMs = 5_000,
    forceGraceMs = 2_000,
    probeExecutable,
    rawCaptureDir = null,
    rawCaptureEnabled = false,
    rawFlushTimeoutMs = 2_000,
    mcpEnabled = true,
    mcpBridgeEnabled,
    mcpEndpointUrl = null,
    bridgePort = null,
    tlsCertPath = null,
    configuredModels = [],
  } = {}) {
    this.#executable = executable;
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.#continuationStore = continuationStore;
    this.#hookScriptPath = hookScriptPath;
    this.#cancelGraceMs = cancelGraceMs;
    this.#forceGraceMs = forceGraceMs;
    this.#probeExecutable = probeExecutable ?? (spawnProcess !== spawn ? () => true : defaultProbeClaudeExecutable);
    this.#mcpEnabled = mcpBridgeEnabled !== undefined ? Boolean(mcpBridgeEnabled) : Boolean(mcpEnabled);
    this.#mcpEndpointUrl = mcpEndpointUrl || (bridgePort ? `http://127.0.0.1:${bridgePort}/mcp` : null);
    this.#tlsCertPath =
      tlsCertPath ||
      process.env.NEVO_TLS_CERT_PATH ||
      (existsSync(resolve(this.#cwd, 'tools', 'dashboard', 'config', 'tls-cert.pem'))
        ? resolve(this.#cwd, 'tools', 'dashboard', 'config', 'tls-cert.pem')
        : existsSync(resolve(__dirname, '..', '..', '..', 'config', 'tls-cert.pem'))
          ? resolve(__dirname, '..', '..', '..', 'config', 'tls-cert.pem')
          : null);
    this.#rawCapture = new RawCaptureRecorder({
      providerId: 'claude',
      rawCaptureDir: rawCaptureEnabled
        ? rawCaptureDir || resolve(this.#cwd, '.nevo-ai-local', 'claude_raw')
        : rawCaptureDir
          ? resolve(rawCaptureDir)
          : null,
      rawCaptureEnabled,
      rawFlushTimeoutMs,
    });
    this.#configuredModels = Array.isArray(configuredModels) ? configuredModels : [];
  }

  configureMcpEndpoint(urlOrResolver) {
    this.#mcpEndpointUrl = urlOrResolver;
  }

  #resolveMcpEndpointUrl() {
    if (typeof this.#mcpEndpointUrl === 'function') {
      try {
        return this.#mcpEndpointUrl();
      } catch {
        return null;
      }
    }
    if (typeof this.#mcpEndpointUrl === 'string' && this.#mcpEndpointUrl.trim()) {
      return this.#mcpEndpointUrl.trim();
    }
    return process.env.NEVO_MCP_ENDPOINT_URL || null;
  }

  get capabilities() {
    const endpointUrl = this.#resolveMcpEndpointUrl();
    const isMcpUsable = Boolean(this.#mcpEnabled && endpointUrl);
    return Object.freeze({
      ...CLAUDE_CAPABILITIES,
      interactiveQuestions: isMcpUsable,
      interactiveConfirmations: false,
    });
  }

  get descriptor() {
    return Object.freeze({
      id: 'claude',
      label: 'Claude Code',
      enabled: true,
      capabilities: this.capabilities,
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'edit',
    });
  }

  async listModels() {
    // `source` is never trusted from the operator-configured entry itself — it is always
    // truthfully forced to 'configured' here, never spoofable as 'known'/'discovered'.
    const configured = this.#configuredModels.map((m) =>
      createAgentModelDescriptor({ id: m.id, label: m.label, isDefault: m.isDefault, traits: m.traits, source: 'configured' }),
    );
    const modelsById = new Map();
    for (const m of CLAUDE_CURATED_MODELS) {
      modelsById.set(m.id, m);
    }
    for (const m of configured) {
      modelsById.set(m.id, m);
    }
    return Array.from(modelsById.values());
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
          unavailableReason: `Claude Code CLI ('${this.#executable}') is not found in PATH. Install Claude Code CLI to enable this provider.`,
        };
    this.#availabilityCache = { checkedAt: now, result };
    return result;
  }

  get continuationStore() {
    return this.#continuationStore;
  }

  #createSettingsFile() {
    const hookCmd = `node "${this.#hookScriptPath.replace(/\\/g, '/')}"`;

    const settings = {
      permissions: {
        allow: ['mcp__nevo__ask_user'],
      },
      hooks: {
        PreToolUse: [
          {
            matcher: 'AskUserQuestion',
            hooks: [
              {
                type: 'command',
                command: hookCmd,
              },
            ],
          },
        ],
      },
    };
    const settingsPath = join(tmpdir(), `nevo-claude-settings-${randomUUID()}.json`);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return settingsPath;
  }

  #createMcpConfigFile({ mcpUrl, token }) {
    const configPath = join(tmpdir(), `nevo-claude-mcp-${randomUUID()}.json`);
    const mcpConfig = {
      mcpServers: {
        nevo: {
          type: 'http',
          url: mcpUrl,
          headers: {
            'x-nevo-interaction-token': token,
          },
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    return configPath;
  }

  async startTurn(params = {}) {
    const userPrompt = params.message ?? params.prompt;
    if (!userPrompt || typeof userPrompt !== 'string') {
      throw new AiValidationError('A valid message/prompt is required.');
    }
    const mode = params.mode ? validateAgentExecutionMode(params.mode) : 'edit';

    // A providerSessionId alone does not mean Claude has ever seen this conversation:
    // callers that only pre-allocated a local placeholder (never confirmed by Claude)
    // must explicitly say so via isSessionEstablished === false, so the fresh identity
    // is created (--session-id) instead of a nonexistent one being resumed (--resume).
    const isNew = !params.providerSessionId || params.isSessionEstablished === false;
    const effectiveSessionId = params.providerSessionId || randomUUID();
    const isMaterialized = this.#materializedSessions.has(effectiveSessionId);
    const initialFlag = isNew && !isMaterialized ? '--session-id' : '--resume';

    try {
      return await this.#startTurnWithSession({ ...params, mode }, { effectiveSessionId, sessionFlag: initialFlag });
    } catch (err) {
      const isSessionNotFound =
        err instanceof AiError &&
        (err.message.includes('No conversation found with session ID') ||
          err.message.includes('not match any session'));

      if (initialFlag === '--resume' && isSessionNotFound) {
        console.warn(`[claude] session ${effectiveSessionId} not found in Claude CLI DB, retrying with --session-id`);
        this.#materializedSessions.delete(effectiveSessionId);
        return await this.#startTurnWithSession(
          { ...params, mode },
          { effectiveSessionId, sessionFlag: '--session-id' },
        );
      }
      throw err;
    }
  }

  async #startTurnWithSession(
    {
      turnId,
      providerSessionId,
      setProviderSessionId,
      identity,
      message,
      prompt,
      mode = 'edit',
      model,
      signal,
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
    } = {},
    { effectiveSessionId, sessionFlag },
  ) {
    const commentaryDelta = emitCommentaryDelta;
    const finalAnswerDelta = emitFinalAnswerDelta;
    const userPrompt = message ?? prompt;
    const settingsPath = this.#createSettingsFile();
    let mcpConfigPath = null;
    const permissionMode = mode === 'ask' ? 'plan' : mode === 'agent' ? 'bypassPermissions' : 'acceptEdits';

    const args = [
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--settings',
      settingsPath,
      sessionFlag,
      effectiveSessionId,
      '--permission-mode',
      permissionMode,
    ];

    if (typeof model === 'string' && model.trim()) {
      const trimmedModel = model.trim();
      args.push('--model', trimmedModel);
      const isKnown =
        CLAUDE_CURATED_MODELS.some((m) => m.id === trimmedModel) ||
        (Array.isArray(this.#configuredModels) && this.#configuredModels.some((m) => m.id === trimmedModel));
      if (!isKnown) {
        console.warn(`[claude] unlisted model '${trimmedModel}' passed through permissively to CLI.`);
      }
    }

    let token = null;
    const resolvedMcpUrl = this.#resolveMcpEndpointUrl();
    if (this.#mcpEnabled && resolvedMcpUrl) {
      token = randomUUID();
      mcpConfigPath = this.#createMcpConfigFile({ mcpUrl: resolvedMcpUrl, token });
      args.push(
        '--mcp-config',
        mcpConfigPath,
        '--append-system-prompt',
        'When you need user clarification, approval, or to ask multiple choice questions, call the ask_user tool.',
      );
    }

    console.log(`[claude] spawning CLI: ${this.#executable} ${args.join(' ')}`);
    this.#rawCapture.logCapturePathOnce(effectiveSessionId);
    return new Promise((resolve, reject) => {
      let child;
      try {
        const childEnv = { ...process.env, CLAUDE_INTERACTIVE: '0' };
        // Scoped CA trust must be decided fresh for this endpoint, never inherited from
        // whatever the parent Nevo process's own ambient environment happens to carry.
        delete childEnv.NODE_EXTRA_CA_CERTS;
        if (resolvedMcpUrl?.startsWith('https:') && this.#tlsCertPath && existsSync(this.#tlsCertPath)) {
          childEnv.NODE_EXTRA_CA_CERTS = this.#tlsCertPath;
        }
        const spawnOpts = getProcessTreeSpawnOptions({
          cwd: this.#cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: childEnv,
        });
        child = this.#spawnProcess(this.#executable, args, spawnOpts);
      } catch (err) {
        console.error(`[claude] spawn failed: ${err.message}`);
        try {
          unlinkSync(settingsPath);
        } catch {}
        if (mcpConfigPath) {
          try {
            unlinkSync(mcpConfigPath);
          } catch {}
        }
        const spawnErrorCode = err.code === 'ENOENT' ? 'AI_PROVIDER_UNAVAILABLE' : 'AI_TRANSPORT_ERROR';
        const status = err.code === 'ENOENT' ? 503 : 502;
        const recoveryHint = err.code === 'ENOENT' ? 'operator-action' : 'new-turn';
        return reject(
          new AiError(spawnErrorCode, `Failed to spawn claude CLI: ${err.message}`, { status, recoveryHint, cause: err }),
        );
      }

      const operation = { childProcess: child, cancelled: false, turnId };
      if (setOperation) setOperation(operation);

      if (requestInteraction) {
        mcpInteractionRegistry.registerActiveTurn(turnId, {
          token,
          provider: 'claude',
          providerSessionId: effectiveSessionId,
          requestInteraction,
        });
      }

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            operation.cancelled = true;
            if (child) {
              terminateChildProcess(child, {
                graceMs: this.#cancelGraceMs,
                forceGraceMs: this.#forceGraceMs,
              }).catch(() => {});
            }
          },
          { once: true },
        );
      }

      let lineBuffer = '';
      let activeThinking = false;
      const activeTools = new Map();
      let hasExecutedTools = false;
      let isDeferred = false;
      let deferredPayload = null;
      let isMaterialized = sessionFlag === '--resume';
      let commentaryCounter = 0;
      let pendingCommentary = null;

      const flushPendingCommentary = () => {
        if (pendingCommentary && pendingCommentary.chunks.length > 0) {
          if (commentaryDelta) {
            for (const chunk of pendingCommentary.chunks) {
              commentaryDelta(chunk, pendingCommentary.id);
            }
          }
          pendingCommentary = null;
        }
      };

      const cleanupSettings = (error) => {
        try {
          unlinkSync(settingsPath);
        } catch {}
        if (mcpConfigPath) {
          try {
            unlinkSync(mcpConfigPath);
          } catch {}
          mcpConfigPath = null;
        }
        mcpInteractionRegistry.unregisterActiveTurn(turnId, error);
      };

      const maybeConfirmSession = async (event) => {
        if (!isMaterialized && event.session_id === effectiveSessionId) {
          isMaterialized = true;
          this.#materializedSessions.add(effectiveSessionId);
          if (setProviderSessionId) {
            try {
              await setProviderSessionId(effectiveSessionId);
            } catch (bindingErr) {
              try {
                child.kill('SIGINT');
              } catch {}
              cleanupSettings();
              reject(bindingErr);
            }
          }
        }
      };

      const processLine = async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (event.session_id) {
          await maybeConfirmSession(event);
        }

        switch (event.type) {
          case 'assistant': {
            const contentBlocks = Array.isArray(event.content)
              ? event.content
              : Array.isArray(event.message?.content)
                ? event.message.content
                : [];

            const containsToolUse = contentBlocks.some((b) => b.type === 'tool_use');
            if (containsToolUse) {
              hasExecutedTools = true;
              flushPendingCommentary();
            }

            for (const block of contentBlocks) {
              if (block.type === 'thinking' && block.thinking) {
                if (emitReasoningDelta) emitReasoningDelta(block.thinking);
              } else if (block.type === 'text' && block.text) {
                if (containsToolUse || activeTools.size > 0) {
                  flushPendingCommentary();
                  if (commentaryDelta) {
                    commentaryDelta(block.text, `commentary-${turnId}-${++commentaryCounter}`);
                  }
                } else {
                  flushPendingCommentary();
                  pendingCommentary = {
                    chunks: [block.text],
                    id: `commentary-${turnId}-${++commentaryCounter}`,
                  };
                }
              } else if (block.type === 'tool_use') {
                const toolId = block.id;
                const toolName = block.name;
                const input = block.input || {};
                const { kind, title, description } = mapClaudeTool(toolName, input);
                activeTools.set(toolId, { id: toolId, name: toolName, kind, title, description, input });
                if (emitToolStarted) {
                  emitToolStarted({
                    toolId,
                    toolName,
                    input,
                    kind,
                    title,
                    description,
                    status: 'active',
                  });
                }
              }
            }

            const usage = event.usage || event.message?.usage;
            if (usage && emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: usage.input_tokens,
                tokensOut: usage.output_tokens,
              });
            }
            break;
          }

          case 'content_block_start': {
            if (event.content_block?.type === 'thinking') {
              activeThinking = true;
              if (event.content_block.thinking && emitReasoningDelta) {
                emitReasoningDelta(event.content_block.thinking);
              }
            } else if (event.content_block?.type === 'text') {
              if (event.content_block.text) {
                if (activeTools.size > 0) {
                  flushPendingCommentary();
                  if (commentaryDelta)
                    commentaryDelta(event.content_block.text, `commentary-${turnId}-${++commentaryCounter}`);
                } else {
                  if (pendingCommentary) {
                    pendingCommentary.chunks.push(event.content_block.text);
                  } else {
                    pendingCommentary = {
                      chunks: [event.content_block.text],
                      id: `commentary-${turnId}-${++commentaryCounter}`,
                    };
                  }
                }
              }
            } else if (event.content_block?.type === 'tool_use') {
              hasExecutedTools = true;
              flushPendingCommentary();
              const toolId = event.content_block.id;
              const toolName = event.content_block.name;
              const input = event.content_block.input || {};
              const { kind, title, description } = mapClaudeTool(toolName, input);
              activeTools.set(toolId, {
                id: toolId,
                name: toolName,
                kind,
                title,
                description,
                input,
                index: event.index,
              });
              if (emitToolStarted) {
                emitToolStarted({
                  toolId,
                  toolName,
                  input,
                  kind,
                  title,
                  description,
                  status: 'active',
                });
              }
            }
            break;
          }
          case 'content_block_delta': {
            if (event.delta?.type === 'thinking_delta') {
              if (event.delta.thinking && emitReasoningDelta) {
                emitReasoningDelta(event.delta.thinking);
              }
            } else if (event.delta?.type === 'text_delta') {
              if (event.delta.text) {
                if (activeTools.size > 0) {
                  flushPendingCommentary();
                  if (commentaryDelta)
                    commentaryDelta(event.delta.text, `commentary-${turnId}-${commentaryCounter || 1}`);
                } else {
                  if (pendingCommentary) {
                    pendingCommentary.chunks.push(event.delta.text);
                  } else {
                    pendingCommentary = {
                      chunks: [event.delta.text],
                      id: `commentary-${turnId}-${++commentaryCounter}`,
                    };
                  }
                }
              }
            } else if (event.delta?.type === 'input_json_delta') {
              let targetTool = null;
              if (typeof event.index === 'number') {
                for (const t of activeTools.values()) {
                  if (t.index === event.index) {
                    targetTool = t;
                    break;
                  }
                }
              }
              if (!targetTool && activeTools.size === 1) {
                targetTool = Array.from(activeTools.values())[0];
              }
              if (targetTool && emitToolUpdated) {
                emitToolUpdated({ toolId: targetTool.id, status: 'active' });
              }
            }
            break;
          }
          case 'content_block_stop': {
            if (activeThinking) activeThinking = false;
            break;
          }
          case 'message_delta': {
            if (event.delta?.stop_reason === 'tool_deferred') {
              isDeferred = true;
              deferredPayload =
                event.deferred_tool_use ||
                event.delta?.deferred_tool_use ||
                (activeTools.size > 0 ? Array.from(activeTools.values())[0] : null);
            }
            if (event.usage && emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: event.usage.input_tokens,
                tokensOut: event.usage.output_tokens,
              });
            }
            break;
          }
          case 'user': {
            const userContent = Array.isArray(event.content)
              ? event.content
              : Array.isArray(event.message?.content)
                ? event.message.content
                : [];

            for (const block of userContent) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const toolId = block.tool_use_id;
                const isError = Boolean(block.is_error);
                const status = isError ? 'failed' : 'completed';
                const durationMs = block.tool_use_result?.durationMs ?? event.tool_use_result?.durationMs ?? undefined;
                const output =
                  event.tool_use_result?.stdout ||
                  (typeof block.content === 'string'
                    ? block.content
                    : block.content !== undefined
                      ? JSON.stringify(block.content)
                      : isError
                        ? 'Tool execution failed'
                        : 'executed');

                if (emitToolCompleted) {
                  emitToolCompleted({
                    toolId,
                    output,
                    durationMs,
                    status,
                  });
                }
                activeTools.delete(toolId);
              }
            }
            break;
          }

          case 'result': {
            for (const [toolId, tool] of activeTools.entries()) {
              if (emitToolCompleted) {
                emitToolCompleted({ toolId, output: 'executed', status: 'failed', closureReason: 'turn_completed' });
              }
            }
            activeTools.clear();

            if (event.terminal_reason === 'tool_deferred' || event.stop_reason === 'tool_deferred') {
              isDeferred = true;
              deferredPayload = event.deferred_tool_use || event.delta?.deferred_tool_use || deferredPayload;
            }
            if (event.subtype === 'error' || event.is_error === true) {
              const rawMsg =
                event.error?.message ||
                event.result ||
                (event.api_error_status ? `API error ${event.api_error_status}` : 'Claude turn failed.');
              const err = mapClaudeError(
                { message: rawMsg, ...(event.api_error_status ? { status: event.api_error_status } : {}) },
                rawMsg,
              );
              cleanupSettings(err);
              reject(err);
              return;
            }

            if (pendingCommentary && pendingCommentary.chunks.length > 0 && !isDeferred) {
              if (finalAnswerDelta) {
                for (const chunk of pendingCommentary.chunks) {
                  finalAnswerDelta(chunk, 'final-answer');
                }
              }
              pendingCommentary = null;
            } else if (event.result && typeof event.result === 'string' && !isDeferred) {
              if (finalAnswerDelta) {
                finalAnswerDelta(event.result, 'final-answer');
              }
            }
            if (event.usage && emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: event.usage.input_tokens,
                tokensOut: event.usage.output_tokens,
              });
            }
            break;
          }

          case 'error': {
            const rawMsg = event.error?.message || 'Claude turn failed.';
            const err = mapClaudeError(rawMsg, rawMsg);
            cleanupSettings(err);
            reject(err);
            break;
          }
          default:
            break;
        }
      };

      let processingQueue = Promise.resolve();

      child.stdout?.on('data', (chunk) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
          this.#rawCapture.recordRawEvent({
            sessionId: effectiveSessionId,
            turnId,
            stream: 'stdout',
            line,
          });
          processingQueue = processingQueue
            .then(() => processLine(line))
            .catch((err) => {
              cleanupSettings();
              reject(err);
            });
        }
      });

      let stderrOutput = '';
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        stderrOutput += text;
        this.#rawCapture.recordRawEvent({
          sessionId: effectiveSessionId,
          turnId,
          stream: 'stderr',
          line: text,
        });
        console.warn(`[claude] [stderr] ${text.trim()}`);
      });

      child.on('error', (err) => {
        console.error(`[claude] [process-error] ${err.message}`);
        const aiErr = mapClaudeError(err, `Claude process error: ${err.message}`);
        cleanupSettings(aiErr);
        reject(aiErr);
      });

      child.on('close', async (exitCode) => {
        console.log(`[claude] process exited code=${exitCode} isDeferred=${isDeferred}`);
        try {
          await processingQueue;
        } catch (e) {
          cleanupSettings(e);
          return reject(e);
        }
        if (lineBuffer.trim()) {
          this.#rawCapture.recordRawEvent({
            sessionId: effectiveSessionId,
            turnId,
            stream: 'stdout',
            line: lineBuffer,
          });
          try {
            await processLine(lineBuffer);
          } catch (e) {
            return reject(e);
          }
        }

        for (const [toolId, tool] of activeTools.entries()) {
          if (emitToolCompleted) {
            emitToolCompleted({
              toolId,
              output: 'executed',
              status: 'failed',
              closureReason: exitCode === 0 ? 'turn_completed' : 'process_exit',
            });
          }
        }
        if (pendingCommentary && pendingCommentary.chunks.length > 0 && !isDeferred) {
          if (finalAnswerDelta) {
            for (const chunk of pendingCommentary.chunks) {
              finalAnswerDelta(chunk, 'final-answer');
            }
          }
          pendingCommentary = null;
        }

        await this.#rawCapture.flushRawCaptureBounded(effectiveSessionId);

        if (operation.cancelled) {
          const cancelErr = new AiError('AI_TURN_CANCELLED', 'Claude turn was cancelled.', { status: 409 });
          cleanupSettings(cancelErr);
          return reject(cancelErr);
        }

        if (isDeferred && deferredPayload) {
          cleanupSettings();
          const publicInteractionId = `int-${randomUUID()}`;
          const isQuestion =
            deferredPayload.name === 'AskUserQuestion' || Array.isArray(deferredPayload.input?.questions);

          let interaction;
          if (isQuestion) {
            interaction = {
              id: publicInteractionId,
              kind: 'question',
              questions:
                deferredPayload.input?.questions?.map((q, idx) => ({
                  id: `q-${idx + 1}`,
                  question: q.question,
                  header: q.header,
                  options: q.options,
                  multiSelect: Boolean(q.multiSelect),
                })) || [],
            };
          } else {
            interaction = {
              id: publicInteractionId,
              kind: 'permission',
              toolName: deferredPayload.name || 'tool',
              input: deferredPayload.input || {},
              ...(deferredPayload.input?.command
                ? { details: `Execute command: ${deferredPayload.input.command}` }
                : {}),
            };
          }

          // Durable persistence of private Claude continuation metadata
          try {
            this.#continuationStore.saveDeferred({
              providerSessionId: effectiveSessionId,
              interactionId: publicInteractionId,
              toolUseId: deferredPayload.id,
              toolName: deferredPayload.name,
              toolInput: deferredPayload.input,
              kind: interaction.kind,
            });
          } catch (persistErr) {
            return reject(persistErr);
          }

          if (typeof emitEvent === 'function') {
            emitEvent('interaction.requested', { interaction });
          }

          return resolve({
            operation: null,
            isDeferred: true,
            providerSessionId: effectiveSessionId,
            interaction,
          });
        }

        if (exitCode !== 0 && !isDeferred) {
          const detail = stderrOutput.trim() || 'Process ended unexpectedly (check server logs for details)';
          const exitErr = mapClaudeError(detail, `Claude process exited with code ${exitCode}: ${detail}`, exitCode);
          cleanupSettings(exitErr);
          return reject(exitErr);
        }

        cleanupSettings();

        this.#materializedSessions.add(effectiveSessionId);
        resolve({ operation, providerSessionId: effectiveSessionId });
      });

      // Write initial user input to child stdin
      try {
        const inputMessage = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: userPrompt,
          },
        });
        this.#rawCapture.recordRawEvent({
          sessionId: effectiveSessionId,
          turnId,
          stream: 'stdin',
          line: inputMessage,
        });
        child.stdin?.write(`${inputMessage}\n`);
        child.stdin?.end();
      } catch (err) {
        // stdin write failed
      }
    });
  }

  async respondInteraction({
    turnId,
    providerSessionId,
    interactionId,
    interaction,
    response,
    mode,
    signal,
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
  } = {}) {
    if (!providerSessionId) {
      throw new AiValidationError("'providerSessionId' is required.");
    }

    if (mcpInteractionRegistry.hasPending(interactionId)) {
      mcpInteractionRegistry.resolveResponse(interactionId, response);
      return { continuesTurn: true };
    }

    // Persist resolution in continuation store BEFORE spawning resume
    this.#continuationStore.resolveResponse({
      providerSessionId,
      interactionId,
      userResponse: response,
    });

    try {
      const turnResult = await this.startTurn({
        turnId,
        providerSessionId,
        message: 'Continue',
        mode,
        signal,
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
      });

      // Turn completed successfully: complete/cleanup continuation record
      this.#continuationStore.complete({ providerSessionId, interactionId });
      return turnResult;
    } catch (err) {
      // Continuation remains stored so retry is possible
      throw err;
    }
  }

  async cancelTurn({ operation, error } = {}) {
    if (!operation) return;
    operation.cancelled = true;
    const terminalError =
      error || new AiError('AI_TURN_CANCELLED', 'Claude turn was cancelled.', { status: 409 });
    if (operation.turnId) {
      mcpInteractionRegistry.cancelTurn(operation.turnId, terminalError);
    }
    const child = operation.childProcess;
    if (!child) return;

    const result = await terminateChildProcess(child, {
      graceMs: this.#cancelGraceMs,
      forceGraceMs: this.#forceGraceMs,
    });
    if (!result.terminated) {
      throw new AiError(
        'AI_OPERATION_LOST',
        'Failed to terminate Claude CLI process within bounded timeout.',
        { status: 500, recoveryHint: 'operator-action' },
      );
    }
  }

  async dispose() {
    try {
      await this.#rawCapture.flushAllRawCapture();
    } catch (err) {
      console.warn(`[claude] [raw-capture] Failed to flush raw diagnostics on dispose: ${err?.message || err}`);
    }
  }
}

export function createClaudeAgentProvider(options) {
  return new ClaudeAgentProvider(options);
}
