import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

function resolveAgyExecutable(name = 'agy') {
  if (process.platform === 'win32' && name === 'agy') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const defaultAgyExe = join(localAppData, 'agy', 'bin', 'agy.exe');
      if (existsSync(defaultAgyExe)) return defaultAgyExe;
    }
  }
  return name;
}

export class AntigravityAgentProvider {
  #executable;
  #cwd;
  #spawnProcess;
  #activeOperations = new Map();
  #availabilityCache = { checkedAt: 0, result: null };
  #cancelGraceMs;

  constructor({
    executable = 'agy',
    cwd = process.cwd(),
    spawnProcess = spawn,
    cancelGraceMs = 5_000,
  } = {}) {
    this.#executable = resolveAgyExecutable(executable);
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.#cancelGraceMs = cancelGraceMs;
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
      if (existsSync(this.#executable)) {
        available = true;
      } else {
        const probe = process.platform === 'win32' ? `where.exe "${this.#executable}"` : `which "${this.#executable}"`;
        execSync(probe, { stdio: 'ignore', timeout: 1500 });
        available = true;
      }
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
        '--print', inputMessage,
        '--output-format', 'stream-json',
      ];

      if (mode === 'ask') {
        args.push('--mode=plan');
      } else if (mode === 'agent') {
        args.push('--mode=accept-edits', '--dangerously-skip-permissions');
      } else {
        args.push('--mode=accept-edits');
      }

      if (providerSessionId) {
        args.push('--conversation', providerSessionId);
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

        let raw;
        try {
          raw = JSON.parse(trimmed);
        } catch {
          // Fallback to plain streaming text if not JSON
          sendTextDelta(trimmed + '\n');
          return;
        }

        const eventType = raw.event || raw.type;
        const payload = raw.step_update || raw.result || raw.init || raw;
        const sessId = raw.conversation_id || raw.conversationId || payload.conversation_id || payload.conversationId || raw.session_id || raw.sessionId;
        if (sessId) {
          await confirmSession(sessId);
        }

        if (eventType === 'init' || eventType === 'conversation_started') {
          if (sessId) await confirmSession(sessId);
          return;
        }

        if (eventType === 'step_update') {
          if (payload.text_delta) {
            sendTextDelta(payload.text_delta);
          }
          if (payload.thought || payload.thinking) {
            if (emitReasoningDelta) emitReasoningDelta(payload.thought || payload.thinking);
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
              if (emitToolCompleted) {
                emitToolCompleted({ toolId: activeTool.id, output: 'executed', status: 'completed' });
              }
              activeTool = null;
            }
            if (raw.result && typeof raw.result === 'string') {
              sendTextDelta(raw.result);
            }
            const usageObj = payload?.usage || raw.usage;
            if (usageObj && emitUsageUpdated) {
              emitUsageUpdated({
                tokensIn: usageObj.tokensIn || usageObj.input_tokens,
                tokensOut: usageObj.tokensOut || usageObj.output_tokens,
                cost: usageObj.cost,
              });
            }
            isDone = true;
            break;
          }

          case 'error': {
            cleanup();
            reject(new AiError('AI_PROVIDER_ERROR', raw.error?.message || raw.message || 'Antigravity turn failed.'));
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
      this.#activeOperations.delete(turnId);
      const child = operation.child;
      if (child && !child.killed) {
        try { child.kill('SIGINT'); } catch {}
        const exited = await waitForChildExit(child, this.#cancelGraceMs);
        if (!exited) {
          // SIGINT didn't stop it within the grace period — escalate to a forceful,
          // unsignaled kill (the only reliable forced-termination path on Windows;
          // equivalent to SIGKILL on POSIX) so cancellation is never a silent no-op.
          try { child.kill(); } catch {}
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

function waitForChildExit(child, timeoutMs) {
  if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }
    child.once('exit', onExit);
  });
}

export function createAntigravityAgentProvider(options) {
  return new AntigravityAgentProvider(options);
}
