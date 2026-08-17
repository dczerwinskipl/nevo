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

test('first turn for newly created session uses --session-id and subsequent turn uses --resume', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'ok' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines);
    },
  });

  // 1. Create a new session
  const created = await provider.createSession({ title: 'New Conversation' });
  const uuid = created.providerSessionId;

  // 2. First turn for the newly created session
  await provider.startTurn({
    turnId: 'turn-1',
    providerSessionId: uuid,
    message: 'First prompt',
  });

  assert.equal(capturedCalls.length, 1);
  assert.ok(capturedCalls[0].args.includes('--session-id'), 'First turn must use --session-id');
  assert.ok(!capturedCalls[0].args.includes('--resume'), 'Fresh UUID must never go directly to --resume');
  assert.equal(capturedCalls[0].args[capturedCalls[0].args.indexOf('--session-id') + 1], uuid);

  // 3. Second turn for the same session
  await provider.startTurn({
    turnId: 'turn-2',
    providerSessionId: uuid,
    message: 'Follow-up prompt',
  });

  assert.equal(capturedCalls.length, 2);
  assert.ok(capturedCalls[1].args.includes('--resume'), 'Subsequent turn must use --resume');
  assert.ok(!capturedCalls[1].args.includes('--session-id'), 'Subsequent turn must not use --session-id');
  assert.equal(capturedCalls[1].args[capturedCalls[1].args.indexOf('--resume') + 1], uuid);

  // 4. Pre-existing session passed directly to startTurn (not from createSession)
  await provider.startTurn({
    turnId: 'turn-3',
    providerSessionId: 'external-existing-session-uuid',
    message: 'Resume external prompt',
  });

  assert.equal(capturedCalls.length, 3);
  assert.ok(capturedCalls[2].args.includes('--resume'), 'Pre-existing session must use --resume');
  assert.equal(capturedCalls[2].args[capturedCalls[2].args.indexOf('--resume') + 1], 'external-existing-session-uuid');
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
