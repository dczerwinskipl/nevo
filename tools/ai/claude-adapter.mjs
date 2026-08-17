import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  AiError,
  AiValidationError,
} from './contracts.mjs';
import { createClaudeContinuationStore } from './claude-continuation-store.mjs';

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

export class ClaudeAgentProvider {
  #executable;
  #cwd;
  #spawnProcess;
  #continuationStore;
  #hookScriptPath;

  constructor({
    executable = 'claude',
    cwd = process.cwd(),
    spawnProcess = spawn,
    continuationStore = createClaudeContinuationStore({ baseDir: join(cwd, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') }),
    hookScriptPath = HOOK_SCRIPT_PATH,
  } = {}) {
    this.#executable = executable;
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.#continuationStore = continuationStore;
    this.#hookScriptPath = hookScriptPath;
    this.descriptor = Object.freeze({
      id: 'claude',
      label: 'Claude Code',
      enabled: true,
      capabilities: CLAUDE_CAPABILITIES,
    });
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

  async startTurn({
    turnId,
    providerSessionId,
    setProviderSessionId,
    identity,
    message,
    prompt,
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
  } = {}) {
    const userPrompt = message ?? prompt;
    if (!userPrompt || typeof userPrompt !== 'string') {
      throw new AiValidationError('A valid message/prompt is required.');
    }

    const isInitialTurn = !providerSessionId;
    const effectiveSessionId = providerSessionId || randomUUID();

    const settingsPath = this.#createSettingsFile();
    const sessionFlag = isInitialTurn ? '--session-id' : '--resume';
    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--settings', settingsPath,
      sessionFlag, effectiveSessionId,
      '--permission-mode', 'dontAsk',
    ];

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.#spawnProcess(this.#executable, args, {
          cwd: this.#cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, CLAUDE_INTERACTIVE: '0' },
        });
      } catch (err) {
        try { unlinkSync(settingsPath); } catch {}
        return reject(new AiError('AI_PROVIDER_SPAWN_ERROR', `Failed to spawn claude CLI: ${err.message}`, { cause: err }));
      }

      const operation = { childProcess: child, cancelled: false };
      if (setOperation) setOperation(operation);

      if (signal) {
        signal.addEventListener('abort', () => {
          operation.cancelled = true;
          try { child.kill('SIGINT'); } catch {}
        }, { once: true });
      }

      let lineBuffer = '';
      let activeThinking = false;
      let activeTool = null;
      let isDeferred = false;
      let deferredPayload = null;
      let isMaterialized = !isInitialTurn;

      const cleanupSettings = () => {
        try { unlinkSync(settingsPath); } catch {}
      };

      const maybeConfirmSession = async (event) => {
        if (!isMaterialized && event.session_id === effectiveSessionId) {
          isMaterialized = true;
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
          case 'content_block_start': {
            if (event.content_block?.type === 'thinking') {
              activeThinking = true;
              if (event.content_block.thinking && emitReasoningDelta) {
                emitReasoningDelta(event.content_block.thinking);
              }
            } else if (event.content_block?.type === 'text') {
              if (event.content_block.text) {
                if (emitTextDelta) emitTextDelta(event.content_block.text);
                else if (emitDelta) emitDelta(event.content_block.text);
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
                if (emitTextDelta) emitTextDelta(event.delta.text);
                else if (emitDelta) emitDelta(event.delta.text);
              }
            } else if (event.delta?.type === 'input_json_delta' && activeTool) {
              if (emitToolUpdated) {
                emitToolUpdated({ toolId: activeTool.id, status: 'streaming_input' });
              }
            }
            break;
          }
          case 'content_block_stop': {
            if (activeThinking) activeThinking = false;
            if (activeTool) {
              if (emitToolCompleted) {
                emitToolCompleted({ toolId: activeTool.id, output: 'executed' });
              }
              activeTool = null;
            }
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
          case 'result': {
            if (event.terminal_reason === 'tool_deferred' || event.stop_reason === 'tool_deferred') {
              isDeferred = true;
              deferredPayload = event.deferred_tool_use || event.delta?.deferred_tool_use || deferredPayload || activeTool;
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
        stderrOutput += chunk.toString();
      });

      child.on('error', err => {
        cleanupSettings();
        reject(new AiError('AI_PROVIDER_PROCESS_ERROR', `Claude process error: ${err.message}`, { cause: err }));
      });

      child.on('close', async exitCode => {
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
          return reject(new AiError('AI_PROVIDER_EXIT_ERROR', `Claude process exited with code ${exitCode}: ${stderrOutput || 'Unknown error'}`));
        }

        if (!isMaterialized && isInitialTurn) {
          return reject(new AiError('AI_PROVIDER_EXIT_ERROR', 'Claude process exited before confirming session materialization'));
        }

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
    if (operation) {
      operation.cancelled = true;
      if (operation.childProcess) {
        try {
          operation.childProcess.kill('SIGINT');
        } catch {}
      }
    }
  }
}

export function createClaudeAgentProvider(options) {
  return new ClaudeAgentProvider(options);
}
