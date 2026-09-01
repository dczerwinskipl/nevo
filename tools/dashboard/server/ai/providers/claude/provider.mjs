import { spawn, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  AiError,
  AiValidationError,
  validateAgentExecutionMode,
} from '../../contracts.mjs';
import { createClaudeContinuationStore } from './continuation-store.mjs';
import { terminateChildProcess } from '../process-termination.mjs';
import { RawCaptureRecorder, rawCaptureSessionDirectory } from '../raw-capture.mjs';

export { rawCaptureSessionDirectory };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOOK_SCRIPT_PATH = join(__dirname, 'hook.mjs');

export const CLAUDE_CAPABILITIES = Object.freeze({
  interactivePermissions: false,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
});

export function mapClaudeTool(toolName = '', input = {}) {
  const name = String(toolName || '').trim();
  const lower = name.toLowerCase();

  if (['bash', 'terminal', 'executecommand', 'command'].includes(lower)) {
    return {
      kind: 'command',
      title: 'Run command',
      description: typeof input?.command === 'string' ? input.command : undefined,
    };
  }

  if (['read', 'view', 'notebookread'].includes(lower)) {
    return {
      kind: 'read',
      title: 'Read file',
      description: typeof input?.file_path === 'string' ? input.file_path : (typeof input?.path === 'string' ? input.path : undefined),
    };
  }

  if (['write', 'createfile'].includes(lower)) {
    return {
      kind: 'write',
      title: 'Write file',
      description: typeof input?.file_path === 'string' ? input.file_path : (typeof input?.path === 'string' ? input.path : undefined),
    };
  }

  if (['edit', 'multiedit', 'notebookedit', 'fileedit'].includes(lower)) {
    return {
      kind: 'edit',
      title: 'Edit file',
      description: typeof input?.file_path === 'string' ? input.file_path : (typeof input?.path === 'string' ? input.path : undefined),
    };
  }

  if (['glob', 'ls', 'listdirectory', 'listfiles', 'listdir'].includes(lower)) {
    return {
      kind: 'list',
      title: 'List files',
      description: typeof input?.path === 'string' ? input.path : (typeof input?.pattern === 'string' ? input.pattern : undefined),
    };
  }

  if (['grep', 'search', 'find', 'filesearch'].includes(lower)) {
    return {
      kind: 'search',
      title: 'Search files',
      description: typeof input?.pattern === 'string' ? input.pattern : (typeof input?.query === 'string' ? input.query : (typeof input?.path === 'string' ? input.path : undefined)),
    };
  }

  if (['websearch', 'webfetch', 'browser', 'fetch'].includes(lower)) {
    return {
      kind: 'web',
      title: 'Web search / fetch',
      description: typeof input?.url === 'string' ? input.url : (typeof input?.query === 'string' ? input.query : undefined),
    };
  }

  return {
    kind: 'other',
    title: name || 'Tool',
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

  constructor({
    executable = 'claude',
    cwd = process.cwd(),
    spawnProcess = spawn,
    continuationStore = createClaudeContinuationStore({ baseDir: join(cwd, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') }),
    hookScriptPath = HOOK_SCRIPT_PATH,
    cancelGraceMs = 5_000,
    forceGraceMs = 2_000,
    probeExecutable,
    rawCaptureDir = null,
    rawCaptureEnabled = false,
    rawFlushTimeoutMs = 2_000,
  } = {}) {
    this.#executable = executable;
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.#continuationStore = continuationStore;
    this.#hookScriptPath = hookScriptPath;
    this.#cancelGraceMs = cancelGraceMs;
    this.#forceGraceMs = forceGraceMs;
    this.#probeExecutable = probeExecutable ?? (spawnProcess !== spawn ? () => true : defaultProbeClaudeExecutable);
    this.#rawCapture = new RawCaptureRecorder({
      providerId: 'claude',
      rawCaptureDir: rawCaptureEnabled
        ? (rawCaptureDir || resolve(this.#cwd, '.nevo-ai-local', 'claude_raw'))
        : (rawCaptureDir ? resolve(rawCaptureDir) : null),
      rawCaptureEnabled,
      rawFlushTimeoutMs,
    });
    this.descriptor = Object.freeze({
      id: 'claude',
      label: 'Claude Code',
      enabled: true,
      capabilities: CLAUDE_CAPABILITIES,
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'edit',
    });
  }

  getRawCapturePath(sessionId) {
    return this.#rawCapture.getRawCapturePath(sessionId);
  }

  async flushRawCapture(sessionId) {
    return this.#rawCapture.flushRawCapture(sessionId);
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
      : { available: false, unavailableReason: `Claude Code CLI ('${this.#executable}') is not found in PATH. Install Claude Code CLI to enable this provider.` };
    this.#availabilityCache = { checkedAt: now, result };
    return result;
  }

  get continuationStore() {
    return this.#continuationStore;
  }

  #createSettingsFile() {
    const hookCmd = `node "${this.#hookScriptPath.replace(/\\/g, '/')}"`;

    const settings = {
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

  async startTurn(params = {}) {
    const userPrompt = params.message ?? params.prompt;
    if (!userPrompt || typeof userPrompt !== 'string') {
      throw new AiValidationError('A valid message/prompt is required.');
    }
    const mode = params.mode ? validateAgentExecutionMode(params.mode) : 'edit';

    const isNew = !params.providerSessionId;
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
        return await this.#startTurnWithSession({ ...params, mode }, { effectiveSessionId, sessionFlag: '--session-id' });
      }
      throw err;
    }
  }

  async #startTurnWithSession({
    turnId,
    providerSessionId,
    setProviderSessionId,
    identity,
    message,
    prompt,
    mode = 'edit',
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
  } = {}, { effectiveSessionId, sessionFlag }) {
    const commentaryDelta = emitCommentaryDelta;
    const finalAnswerDelta = emitFinalAnswerDelta;
    const userPrompt = message ?? prompt;
    const settingsPath = this.#createSettingsFile();
    const permissionMode =
      mode === 'ask'
        ? 'plan'
        : mode === 'agent'
          ? 'bypassPermissions'
          : 'acceptEdits';

    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--settings', settingsPath,
      sessionFlag, effectiveSessionId,
      '--permission-mode', permissionMode,
    ];

      console.log(`[claude] spawning CLI: ${this.#executable} ${args.join(' ')}`);
      this.#rawCapture.logCapturePathOnce(effectiveSessionId);
      return new Promise((resolve, reject) => {
        let child;
      try {
        child = this.#spawnProcess(this.#executable, args, {
          cwd: this.#cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, CLAUDE_INTERACTIVE: '0' },
        });
      } catch (err) {
        console.error(`[claude] spawn failed: ${err.message}`);
        try { unlinkSync(settingsPath); } catch {}
        return reject(new AiError('AI_PROVIDER_SPAWN_ERROR', `Failed to spawn claude CLI: ${err.message}`, { cause: err }));
      }

      const operation = { childProcess: child, cancelled: false };
      if (setOperation) setOperation(operation);

      if (signal) {
        signal.addEventListener('abort', () => {
          operation.cancelled = true;
          if (child) {
            terminateChildProcess(child, {
              graceMs: this.#cancelGraceMs,
              forceGraceMs: this.#forceGraceMs,
            }).catch(() => {});
          }
        }, { once: true });
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

      const cleanupSettings = () => {
        try { unlinkSync(settingsPath); } catch {}
      };

      const maybeConfirmSession = async (event) => {
        if (!isMaterialized && event.session_id === effectiveSessionId) {
          isMaterialized = true;
          this.#materializedSessions.add(effectiveSessionId);
          if (setProviderSessionId) {
            try {
              await setProviderSessionId(effectiveSessionId);
            } catch (bindingErr) {
              try { child.kill('SIGINT'); } catch {}
              cleanupSettings();
              reject(bindingErr);
            }
          }
        }
      };

      const processLine = async line => {
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
              : (Array.isArray(event.message?.content) ? event.message.content : []);

            const containsToolUse = contentBlocks.some(b => b.type === 'tool_use');
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
                  if (commentaryDelta) commentaryDelta(event.content_block.text, `commentary-${turnId}-${++commentaryCounter}`);
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
              activeTools.set(toolId, { id: toolId, name: toolName, kind, title, description, input, index: event.index });
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
                  if (commentaryDelta) commentaryDelta(event.delta.text, `commentary-${turnId}-${commentaryCounter || 1}`);
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
              deferredPayload = event.deferred_tool_use || event.delta?.deferred_tool_use || (activeTools.size > 0 ? Array.from(activeTools.values())[0] : null);
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
              : (Array.isArray(event.message?.content) ? event.message.content : []);

            for (const block of userContent) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const toolId = block.tool_use_id;
                const isError = Boolean(block.is_error);
                const status = isError ? 'failed' : 'completed';
                const durationMs = block.tool_use_result?.durationMs ?? event.tool_use_result?.durationMs ?? undefined;
                const output = event.tool_use_result?.stdout
                  || (typeof block.content === 'string' ? block.content : (block.content !== undefined ? JSON.stringify(block.content) : (isError ? 'Tool execution failed' : 'executed')));

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
              cleanupSettings();
              reject(new AiError('AI_PROVIDER_ERROR', event.error?.message || event.result || 'Claude turn failed.'));
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
            cleanupSettings();
            reject(new AiError('AI_PROVIDER_ERROR', event.error?.message || 'Claude turn failed.'));
            break;
          }
          default:
            break;
        }
      };

      let processingQueue = Promise.resolve();

      child.stdout?.on('data', chunk => {
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
          processingQueue = processingQueue.then(() => processLine(line)).catch(err => {
            cleanupSettings();
            reject(err);
          });
        }
      });

      let stderrOutput = '';
      child.stderr?.on('data', chunk => {
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

      child.on('error', err => {
        console.error(`[claude] [process-error] ${err.message}`);
        cleanupSettings();
        reject(new AiError('AI_PROVIDER_PROCESS_ERROR', `Claude process error: ${err.message}`, { cause: err }));
      });

      child.on('close', async exitCode => {
        console.log(`[claude] process exited code=${exitCode} isDeferred=${isDeferred}`);
        try {
          await processingQueue;
        } catch (e) {
          cleanupSettings();
          return reject(e);
        }
        cleanupSettings();
        if (lineBuffer.trim()) {
          this.#rawCapture.recordRawEvent({
            sessionId: effectiveSessionId,
            turnId,
            stream: 'stdout',
            line: lineBuffer,
          });
          try { await processLine(lineBuffer); } catch (e) { return reject(e); }
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
          return reject(new AiError('AI_TURN_CANCELLED', 'Claude turn was cancelled.', { status: 409 }));
        }

        if (isDeferred && deferredPayload) {
          const publicInteractionId = `int-${randomUUID()}`;
          const isQuestion = deferredPayload.name === 'AskUserQuestion' || Array.isArray(deferredPayload.input?.questions);

          let interaction;
          if (isQuestion) {
            interaction = {
              id: publicInteractionId,
              kind: 'question',
              questions: deferredPayload.input?.questions?.map((q, idx) => ({
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
              ...(deferredPayload.input?.command ? { details: `Execute command: ${deferredPayload.input.command}` } : {}),
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
          return reject(new AiError('AI_PROVIDER_EXIT_ERROR', `Claude process exited with code ${exitCode}: ${detail}`));
        }

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

  async cancelTurn({ operation } = {}) {
    if (!operation) return;
    operation.cancelled = true;
    const child = operation.childProcess;
    if (!child) return;

    const result = await terminateChildProcess(child, {
      graceMs: this.#cancelGraceMs,
      forceGraceMs: this.#forceGraceMs,
    });
    if (!result.terminated) {
      throw new AiError('AI_PROCESS_TERMINATION_FAILED', 'Failed to terminate Claude CLI process within bounded timeout.', { status: 500 });
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
