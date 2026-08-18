import { spawn, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  AiError,
  AiValidationError,
  CapabilityNotSupportedError,
  validateAgentExecutionMode,
} from './contracts.mjs';

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

export class AntigravityAgentProvider {
  #executable;
  #cwd;
  #spawnProcess;
  #activeOperations = new Map();
  #availabilityCache = { checkedAt: 0, result: null };

  constructor({
    executable = 'agy',
    cwd = process.cwd(),
    spawnProcess = spawn,
  } = {}) {
    this.#executable = executable;
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.descriptor = ANTIGRAVITY_DESCRIPTOR;
  }

  isAvailable({ ttlMs = 30_000 } = {}) {
    if (this.#spawnProcess !== spawn) {
      return { available: true };
    }
    const now = Date.now();
    if (this.#availabilityCache.result && (now - this.#availabilityCache.checkedAt < ttlMs)) {
      return this.#availabilityCache.result;
    }
    let available = false;
    try {
      const probe = process.platform === 'win32' ? `where.exe "${this.#executable}"` : `which "${this.#executable}"`;
      execSync(probe, { stdio: 'ignore', timeout: 1500 });
      available = true;
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
    let isSessionEstablished = Boolean(providerSessionId);

    const sendTextDelta = (chunk) => {
      if (!chunk) return;
      if (emitTextDelta) emitTextDelta(chunk);
      else if (emitDelta) emitDelta(chunk);
    };

    return new Promise((resolve, reject) => {
      let activeTool = null;
      let lineBuffer = '';
      let isDone = false;
      let pendingInteractionPromise = null;

      const args = [
        '--stream', 'json',
        '--output-format', 'stream-json',
      ];

      if (mode === 'ask') {
        args.push('--mode=plan');
      } else if (mode === 'agent') {
        args.push('--mode=default', '--dangerously-skip-permissions');
      } else {
        args.push('--mode=accept-edits');
      }

      if (providerSessionId) {
        args.push('--resume', providerSessionId);
      } else {
        args.push('--conversation-id', effectiveSessionId);
      }

      const operation = {
        turnId,
        providerSessionId: effectiveSessionId,
        cancelled: false,
        child: null,
      };

      if (setOperation) setOperation(operation);
      this.#activeOperations.set(turnId, operation);

      let currentSessionId = providerSessionId || null;

      const confirmSession = async (allocatedId) => {
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
          shell: process.platform === 'win32',
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

      const cleanup = () => {
        this.#activeOperations.delete(turnId);
      };

      if (signal) {
        signal.addEventListener('abort', () => {
          operation.cancelled = true;
          if (child && !child.killed) {
            child.kill('SIGINT');
          }
        }, { once: true });
      }

      const processLine = async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          // Fallback to plain streaming text if not JSON
          sendTextDelta(trimmed + '\n');
          return;
        }

        const sessId = event.conversation_id || event.conversationId || event.session_id || event.sessionId;
        if (sessId) {
          await confirmSession(sessId);
        }

        switch (event.type) {
          case 'init':
          case 'conversation_started': {
            if (sessId) await confirmSession(sessId);
            break;
          }

          case 'text':
          case 'text.delta':
          case 'content': {
            const delta = event.text ?? event.delta ?? event.content ?? '';
            if (delta) sendTextDelta(delta);
            break;
          }

          case 'reasoning':
          case 'reasoning.delta':
          case 'thought': {
            const reasoning = event.reasoning ?? event.delta ?? event.thought ?? '';
            if (reasoning && emitReasoningDelta) emitReasoningDelta(reasoning);
            break;
          }

          case 'tool_use':
          case 'tool.started':
          case 'call': {
            activeTool = {
              id: event.toolId || event.id || `tool-${randomUUID()}`,
              name: event.toolName || event.name || 'tool',
              input: event.input || event.args || {},
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
            if (emitToolUpdated && (event.toolId || activeTool)) {
              emitToolUpdated({
                toolId: event.toolId || activeTool?.id,
                status: event.status || 'running',
                input: event.input,
              });
            }
            break;
          }

          case 'tool_result':
          case 'tool.completed':
          case 'tool_use_result': {
            const toolId = event.toolId || event.tool_use_id || activeTool?.id;
            const output = event.output ?? event.content ?? event.result ?? 'executed';
            if (toolId && emitToolCompleted) {
              emitToolCompleted({
                toolId,
                output,
                status: event.is_error || event.status === 'failed' ? 'failed' : 'completed',
                durationMs: event.durationMs,
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
                id: event.interactionId || `int-${randomUUID()}`,
                kind: 'question',
                prompt: event.question || event.prompt || 'Antigravity requested input',
                questions: event.questions || [{
                  id: event.questionId || 'q1',
                  question: event.question || event.prompt || 'Antigravity requested input',
                  header: event.header || 'Pytanie',
                  options: event.options || [],
                  isMultiSelect: Boolean(event.isMultiSelect),
                }],
              };
              pendingInteractionPromise = requestInteraction(interaction);
            }
            break;
          }

          case 'usage': {
            if (emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: event.tokensIn || event.input_tokens,
                tokensOut: event.tokensOut || event.output_tokens,
                cost: event.cost,
              });
            }
            break;
          }

          case 'result':
          case 'done':
          case 'turn.completed': {
            if (activeTool) {
              if (emitToolCompleted) {
                emitToolCompleted({ toolId: activeTool.id, output: 'executed', status: 'completed' });
              }
              activeTool = null;
            }
            if (event.result && typeof event.result === 'string') {
              sendTextDelta(event.result);
            }
            if (event.usage && emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: event.usage.tokensIn || event.usage.input_tokens,
                tokensOut: event.usage.tokensOut || event.usage.output_tokens,
                cost: event.usage.cost,
              });
            }
            isDone = true;
            break;
          }

          case 'error': {
            cleanup();
            reject(new AiError('AI_PROVIDER_ERROR', event.error?.message || event.message || 'Antigravity turn failed.'));
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
            cleanup();
            reject(err);
          });
        }
      });

      child.stderr?.on('data', chunk => {
        const text = chunk.toString();
        console.warn(`[antigravity] [stderr] ${text.trim()}`);
      });

      child.on('error', err => {
        cleanup();
        const msg = err.code === 'ENOENT'
          ? `Antigravity CLI ('${this.#executable}') not found. Ensure Antigravity CLI ('agy') is installed and available in PATH.`
          : `Antigravity process error: ${err.message}`;
        reject(new AiError('AI_PROVIDER_PROCESS_ERROR', msg, { cause: err }));
      });

      child.on('close', async exitCode => {
        try {
          await processingQueue;
        } catch (e) {
          cleanup();
          return reject(e);
        }

        cleanup();

        if (lineBuffer.trim()) {
          try { await processLine(lineBuffer); } catch (e) { return reject(e); }
        }

        if (activeTool) {
          if (emitToolCompleted) {
            emitToolCompleted({ toolId: activeTool.id, output: 'executed', status: 'completed' });
          }
          activeTool = null;
        }

        if (operation.cancelled) {
          return reject(new AiError('AI_TURN_CANCELLED', 'Antigravity turn was cancelled.', { status: 409 }));
        }

        if (pendingInteractionPromise) {
          try {
            await pendingInteractionPromise;
          } catch (e) {
            return reject(e);
          }
        }

        if (exitCode !== 0 && !isDone) {
          return reject(new AiError('AI_PROVIDER_EXIT_ERROR', `Antigravity process exited with non-zero code ${exitCode}.`));
        }

        resolve({
          turnId,
          providerSessionId: currentSessionId || effectiveSessionId,
          status: 'completed',
        });
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
        cleanup();
        reject(new AiError('AI_PROVIDER_WRITE_ERROR', `Failed to write to Antigravity stdin: ${err.message}`, { cause: err }));
      }
    });
  }

  async cancelTurn({ turnId, providerSessionId } = {}) {
    const operation = turnId ? this.#activeOperations.get(turnId) : null;
    if (operation) {
      operation.cancelled = true;
      if (operation.child && !operation.child.killed) {
        operation.child.kill('SIGINT');
      }
      this.#activeOperations.delete(turnId);
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

export function createAntigravityAgentProvider(options) {
  return new AntigravityAgentProvider(options);
}
