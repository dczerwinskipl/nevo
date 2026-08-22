import { spawn, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  AiError,
  AiValidationError,
  validateAgentExecutionMode,
} from './contracts.mjs';
import { createClaudeContinuationStore } from './claude-continuation-store.mjs';
import { terminateChildProcess } from './process-termination.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOOK_SCRIPT_PATH = join(__dirname, 'claude-hook.mjs');

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

  constructor({
    executable = 'claude',
    cwd = process.cwd(),
    spawnProcess = spawn,
    continuationStore = createClaudeContinuationStore({ baseDir: join(cwd, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') }),
    hookScriptPath = HOOK_SCRIPT_PATH,
    cancelGraceMs = 5_000,
    forceGraceMs = 2_000,
    probeExecutable,
  } = {}) {
    this.#executable = executable;
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.#continuationStore = continuationStore;
    this.#hookScriptPath = hookScriptPath;
    this.#cancelGraceMs = cancelGraceMs;
    this.#forceGraceMs = forceGraceMs;
    this.#probeExecutable = probeExecutable ?? (spawnProcess !== spawn ? () => true : defaultProbeClaudeExecutable);
    this.descriptor = Object.freeze({
      id: 'claude',
      label: 'Claude Code',
      enabled: true,
      capabilities: CLAUDE_CAPABILITIES,
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'edit',
    });
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
      return await this.#runClaudeProcess({ ...params, mode }, { effectiveSessionId, sessionFlag: initialFlag });
    } catch (err) {
      const isSessionNotFound =
        err instanceof AiError &&
        (err.message.includes('No conversation found with session ID') ||
         err.message.includes('not match any session'));

      if (initialFlag === '--resume' && isSessionNotFound) {
        console.warn(`[claude] session ${effectiveSessionId} not found in Claude CLI DB, retrying with --session-id`);
        this.#materializedSessions.delete(effectiveSessionId);
        return await this.#runClaudeProcess({ ...params, mode }, { effectiveSessionId, sessionFlag: '--session-id' });
      }
      throw err;
    }
  }

  async #runClaudeProcess({
    turnId,
    providerSessionId,
    setProviderSessionId,
    identity,
    message,
    prompt,
    mode = 'edit',
    signal,
    setOperation,
    emitDelta,
    emitTextDelta,
    emitReasoningDelta,
    emitToolStarted,
    emitToolUpdated,
    emitToolCompleted,
    emitUsageUpdated,
    emitEvent,
    requestInteraction,
  } = {}, { effectiveSessionId, sessionFlag }) {
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
      let activeTool = null;
      let isDeferred = false;
      let deferredPayload = null;
      let isMaterialized = sessionFlag === '--resume';
      let emittedAnyText = false;

      const sendTextDelta = text => {
        if (!text) return;
        emittedAnyText = true;
        if (emitTextDelta) emitTextDelta(text);
        else if (emitDelta) emitDelta(text);
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
            const message = event.message;
            if (message && Array.isArray(message.content)) {
              for (const block of message.content) {
                if (block.type === 'thinking' && block.thinking) {
                  if (emitReasoningDelta) emitReasoningDelta(block.thinking);
                } else if (block.type === 'text' && block.text) {
                  sendTextDelta(block.text);
                } else if (block.type === 'tool_use') {
                  activeTool = {
                    id: block.id,
                    name: block.name,
                    input: block.input || {},
                  };
                  if (emitToolStarted) {
                    emitToolStarted({
                      toolId: activeTool.id,
                      toolName: activeTool.name,
                      input: activeTool.input,
                    });
                  }
                }
              }
            }
            if (message?.usage && emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: message.usage.input_tokens,
                tokensOut: message.usage.output_tokens,
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
                sendTextDelta(event.content_block.text);
              }
            } else if (event.content_block?.type === 'tool_use') {
              activeTool = {
                id: event.content_block.id,
                name: event.content_block.name,
                input: event.content_block.input || {},
              };
              if (emitToolStarted) {
                emitToolStarted({
                  toolId: activeTool.id,
                  toolName: activeTool.name,
                  input: activeTool.input,
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
                sendTextDelta(event.delta.text);
              }
            } else if (event.delta?.type === 'input_json_delta' && activeTool) {
              if (emitToolUpdated) {
                emitToolUpdated({ toolId: activeTool.id, status: 'streaming_input' });
              }
            }
            break;
          }
          case 'content_block_stop': {
            // A `tool_use` content block finishing only means the model stopped
            // streaming the call's arguments — the tool has not actually run yet.
            // The `tool_result` block in the later `user` event (or, if that never
            // arrives, the `result` fallback below) is the only real terminal signal
            // for this toolId (owner-decisions.md D6). Emitting anything here would
            // race or overwrite that real outcome with a synthetic one.
            if (activeThinking) activeThinking = false;
            break;
          }
          case 'message_delta': {
            if (event.delta?.stop_reason === 'tool_deferred') {
              isDeferred = true;
              deferredPayload = event.deferred_tool_use || event.delta?.deferred_tool_use || activeTool;
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
            const message = event.message;
            if (message && Array.isArray(message.content)) {
              for (const block of message.content) {
                if (block.type === 'tool_result' && block.tool_use_id) {
                  if (emitToolCompleted) {
                    const output = event.tool_use_result?.stdout
                      || (typeof block.content === 'string' ? block.content : JSON.stringify(block.content))
                      || 'executed';
                    emitToolCompleted({
                      toolId: block.tool_use_id,
                      output,
                      status: block.is_error ? 'failed' : 'completed',
                    });
                  }
                  if (activeTool && activeTool.id === block.tool_use_id) {
                    activeTool = null;
                  }
                }
              }
            }
            break;
          }

          case 'result': {
            if (activeTool) {
              // The turn ended without a real `tool_result` ever arriving for this
              // toolId — it never received a successful terminal signal, so it
              // resolves to 'failed' regardless of the turn's own outcome
              // (owner-decisions.md D6).
              if (emitToolCompleted) {
                emitToolCompleted({ toolId: activeTool.id, output: 'executed', status: 'failed' });
              }
              activeTool = null;
            }
            if (event.terminal_reason === 'tool_deferred' || event.stop_reason === 'tool_deferred') {
              isDeferred = true;
              deferredPayload = event.deferred_tool_use || event.delta?.deferred_tool_use || deferredPayload || activeTool;
            }
            if (event.result && typeof event.result === 'string' && !emittedAnyText && !isDeferred) {
              sendTextDelta(event.result);
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
          try { await processLine(lineBuffer); } catch (e) { return reject(e); }
        }


        if (operation.cancelled) {
          return reject(new AiError('AI_TURN_CANCELLED', 'Claude turn was cancelled.', { status: 409 }));
        }

        if (isDeferred && deferredPayload) {
          const publicInteractionId = `int-${randomUUID()}`;
          const interaction = {
            id: publicInteractionId,
            kind: 'question',
            questions: deferredPayload.input?.questions?.map((q, idx) => ({
              id: `q-${idx + 1}`,
              question: q.question,
              header: q.header,
              options: q.options,
              multiSelect: q.multiSelect,
            })) || [],
          };

          // Durable persistence of private Claude continuation metadata
          try {
            this.#continuationStore.saveDeferred({
              providerSessionId: effectiveSessionId,
              interactionId: publicInteractionId,
              toolUseId: deferredPayload.id,
              toolName: deferredPayload.name,
              toolInput: deferredPayload.input,
              kind: 'question',
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
    emitDelta,
    emitTextDelta,
    emitReasoningDelta,
    emitToolStarted,
    emitToolUpdated,
    emitToolCompleted,
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
        emitDelta,
        emitTextDelta,
        emitReasoningDelta,
        emitToolStarted,
        emitToolUpdated,
        emitToolCompleted,
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
}

export function createClaudeAgentProvider(options) {
  return new ClaudeAgentProvider(options);
}
