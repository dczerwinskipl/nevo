import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import {
  ClaudeAgentProvider,
  createClaudeAgentProvider,
  CLAUDE_CAPABILITIES,
} from '../ai/claude-adapter.mjs';

function createMockProcess(stdoutLines = [], { exitCode = 0, delayMs = 5 } = {}) {
  const child = new EventEmitter();
  child.stdin = new Writable({
    write(chunk, encoding, callback) { callback(); },
  });
  child.stdout = new Readable({
    read() {},
  });
  child.stderr = new Readable({
    read() {},
  });

  child.kill = (signal) => {
    child.killed = true;
    child.killSignal = signal;
    setImmediate(() => child.emit('close', 0));
  };

  setImmediate(async () => {
    for (const line of stdoutLines) {
      if (child.killed) break;
      child.stdout.push(`${line}\n`);
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    child.stdout.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

test('ClaudeAgentProvider declares capabilities and creates UUID sessions', async () => {
  const provider = createClaudeAgentProvider();
  assert.equal(provider.descriptor.id, 'claude');
  assert.equal(provider.descriptor.capabilities.interactiveQuestions, true);
  assert.equal(provider.descriptor.capabilities.interactivePermissions, true);
  assert.equal(provider.descriptor.capabilities.resumeSession, true);

  const session = await provider.createSession({
    title: 'Test Session',
  });

  assert.equal(session.provider, 'claude');
  assert.ok(session.providerSessionId);
  assert.equal(session.title, 'Test Session');
});


test('ClaudeAgentProvider parses stream-json output and emits deltas and reasoning', async () => {
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'Analyzing codebase...' } }),
    JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' planning changes' } }),
    JSON.stringify({ type: 'content_block_stop', index: 0 }),
    JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'Here is ' } }),
    JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'the solution.' } }),
    JSON.stringify({ type: 'content_block_stop', index: 1 }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 50, output_tokens: 25 } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const textDeltas = [];
  const reasoningDeltas = [];
  let usage = null;

  await provider.startTurn({
    turnId: 'turn-test-1',
    providerSessionId: 'sess-test-1',
    message: 'Hello Claude',
    emitTextDelta: text => textDeltas.push(text),
    emitReasoningDelta: text => reasoningDeltas.push(text),
    emitUsageUpdated: u => { usage = u; },
  });

  assert.deepEqual(textDeltas, ['Here is ', 'the solution.']);
  assert.deepEqual(reasoningDeltas, ['Analyzing codebase...', ' planning changes']);
  assert.deepEqual(usage, { tokensIn: 50, tokensOut: 25 });
});

test('ClaudeAgentProvider intercepts AskUserQuestion tool_deferred and requests interaction', async () => {
  const lines = [
    JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_q_01',
        name: 'AskUserQuestion',
        input: {
          questions: [
            { question: 'Choose style?', header: 'Style', multiSelect: false },
          ],
        },
      },
    }),
    JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'tool_deferred' },
      deferred_tool_use: {
        id: 'toolu_q_01',
        name: 'AskUserQuestion',
        input: {
          questions: [
            { question: 'Choose style?', header: 'Style', multiSelect: false },
          ],
        },
      },
    }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  let requestedInteraction = null;
  const result = await provider.startTurn({
    turnId: 'turn-q-1',
    providerSessionId: 'sess-q-1',
    message: 'Ask me',
    requestInteraction: async interaction => {
      requestedInteraction = interaction;
      return { answers: [{ questionId: 'q-1', value: 'Option A' }] };
    },
  });

  assert.ok(requestedInteraction);
  assert.equal(requestedInteraction.kind, 'question');
  assert.equal(requestedInteraction.questions[0].question, 'Choose style?');
  assert.deepEqual(result.interactionResult, { answers: [{ questionId: 'q-1', value: 'Option A' }] });
});

test('ClaudeAgentProvider supports turn cancellation', async () => {
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Chunk 1' } }),
  ];

  const abortController = new AbortController();
  const provider = createClaudeAgentProvider({
    spawnProcess: () => createMockProcess(lines, { delayMs: 50 }),
  });

  const turnPromise = provider.startTurn({
    turnId: 'turn-cancel-1',
    providerSessionId: 'sess-cancel-1',
    message: 'Cancel me',
    signal: abortController.signal,
  });

  setTimeout(() => abortController.abort(), 10);
  await assert.rejects(() => turnPromise, { name: 'AiError' });
});
