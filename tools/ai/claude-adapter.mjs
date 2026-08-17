import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  AiError,
  AiValidationError,
  normalizeInteraction,
} from './contracts.mjs';

export const CLAUDE_CAPABILITIES = Object.freeze({
  interactivePermissions: true,
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
  #deferredTools = new Map();

  constructor({ executable = 'claude', cwd = process.cwd(), spawnProcess = spawn } = {}) {
    this.#executable = executable;
    this.#cwd = cwd;
    this.#spawnProcess = spawnProcess;
    this.descriptor = Object.freeze({
      id: 'claude',
      label: 'Claude Code',
      enabled: true,
      capabilities: CLAUDE_CAPABILITIES,
    });
  }

  async startTurn({
    turnId,
    providerSessionId,
    setProviderSessionId,
    identity,
    message,
    prompt,
    continuationPayload,
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
    if (!continuationPayload && (!userPrompt || typeof userPrompt !== 'string')) {
      throw new AiValidationError('A valid message/prompt is required.');
    }

    const isInitialTurn = !providerSessionId;
    const effectiveSessionId = providerSessionId || randomUUID();
    if (setProviderSessionId) setProviderSessionId(effectiveSessionId);

    const sessionFlag = isInitialTurn ? '--session-id' : '--resume';
    const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', sessionFlag, effectiveSessionId];

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.#spawnProcess(this.#executable, args, {
          cwd: this.#cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, CLAUDE_INTERACTIVE: '0' },
        });
      } catch (err) {
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

      const processLine = line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          return;
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
              deferredPayload = event.deferred_tool_use;
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
            reject(new AiError('AI_PROVIDER_ERROR', event.error?.message || 'Claude turn failed.'));
            break;
          }
          default:
            break;
        }
      };

      child.stdout?.on('data', chunk => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      });

      let stderrOutput = '';
      child.stderr?.on('data', chunk => {
        stderrOutput += chunk.toString();
      });

      child.on('error', err => {
        reject(new AiError('AI_PROVIDER_PROCESS_ERROR', `Claude process error: ${err.message}`, { cause: err }));
      });

      child.on('close', async exitCode => {
        if (lineBuffer.trim()) processLine(lineBuffer);

        if (operation.cancelled) {
          return reject(new AiError('AI_TURN_CANCELLED', 'Claude turn was cancelled.', { status: 409 }));
        }

        if (isDeferred && deferredPayload) {
          let interaction;
          if (deferredPayload.name === 'AskUserQuestion') {
            interaction = {
              id: deferredPayload.id,
              kind: 'question',
              questions: deferredPayload.input?.questions?.map((q, idx) => ({
                id: `q-${idx + 1}`,
                question: q.question,
                header: q.header,
                options: q.options,
                multiSelect: q.multiSelect,
              })) || [],
            };
          } else {
            interaction = {
              id: deferredPayload.id,
              kind: 'permission',
              toolName: deferredPayload.name,
              input: deferredPayload.input,
            };
          }
          this.#deferredTools.set(`${effectiveSessionId}\u0000${interaction.id}`, {
            toolUseId: deferredPayload.id,
            toolName: deferredPayload.name,
            toolInput: deferredPayload.input,
          });
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

        resolve({ operation, providerSessionId: effectiveSessionId });
      });

      // Write stdin payload
      try {
        let inputMessage;
        if (continuationPayload) {
          inputMessage = JSON.stringify(continuationPayload);
        } else {
          inputMessage = JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: userPrompt,
            },
          });
        }
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

    const deferredKey = `${providerSessionId}\u0000${interactionId}`;
    const deferred = this.#deferredTools.get(deferredKey) || {
      toolUseId: interaction?.id || interactionId,
      toolName: interaction?.toolName || (interaction?.kind === 'question' ? 'AskUserQuestion' : 'Bash'),
      toolInput: interaction?.input,
    };
    this.#deferredTools.delete(deferredKey);

    let continuationPayload;
    if (interaction?.kind === 'question' || deferred.toolName === 'AskUserQuestion') {
      continuationPayload = {
        type: 'tool_result',
        tool_use_id: deferred.toolUseId,
        permissionDecision: 'allow',
        updatedInput: {
          questions: deferred.toolInput?.questions || interaction?.questions || [],
          answers: response?.answers || [],
        },
      };
    } else if (interaction?.kind === 'permission') {
      const isAllowed = response?.decision === 'allow';
      continuationPayload = {
        type: 'tool_result',
        tool_use_id: deferred.toolUseId,
        permissionDecision: isAllowed ? 'allow' : 'deny',
        ...(isAllowed ? {} : { message: response?.message || 'Permission denied by user' }),
      };
    } else {
      continuationPayload = {
        type: 'tool_result',
        tool_use_id: deferred.toolUseId,
        permissionDecision: response?.confirmed ? 'allow' : 'deny',
      };
    }

    return this.startTurn({
      turnId,
      providerSessionId,
      continuationPayload,
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
