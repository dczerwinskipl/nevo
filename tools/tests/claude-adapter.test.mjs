import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import {
  ClaudeAgentProvider,
  createClaudeAgentProvider,
  CLAUDE_CAPABILITIES,
} from '../ai/claude-adapter.mjs';

function createMockProcess(stdoutLines = [], { exitCode = 0, delayMs = 5, sessionId } = {}) {
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
    for (const rawLine of stdoutLines) {
      if (child.killed) break;
      let line = rawLine;
      if (sessionId) {
        try {
          const parsed = JSON.parse(rawLine);
          if (!parsed.session_id) {
            parsed.session_id = sessionId;
            line = JSON.stringify(parsed);
          }
        } catch {}
      }
      child.stdout.push(`${line}\n`);
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    child.stdout.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

function extractSessionId(args = []) {
  const sIdx = args.indexOf('--session-id') !== -1 ? args.indexOf('--session-id') : args.indexOf('--resume');
  return sIdx !== -1 ? args[sIdx + 1] : undefined;
}


test('ClaudeAgentProvider declares capabilities', () => {
  const provider = createClaudeAgentProvider();
  assert.equal(provider.descriptor.id, 'claude');
  assert.equal(provider.descriptor.capabilities.interactiveQuestions, true);
  assert.equal(provider.descriptor.capabilities.interactivePermissions, true);
  assert.equal(provider.descriptor.capabilities.resumeSession, true);
});

test('new Claude conversation uses --session-id and returns generated providerSessionId', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'hello' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines, { sessionId: extractSessionId(args) });
    },
  });

  const result = await provider.startTurn({
    turnId: 'turn-1',
    message: 'First message in fresh conversation',
  });

  assert.equal(capturedCalls.length, 1);
  assert.ok(capturedCalls[0].args.includes('--session-id'), 'First turn must use --session-id');
  assert.ok(!capturedCalls[0].args.includes('--resume'), 'Fresh conversation must not use --resume');
  const sessionIdIndex = capturedCalls[0].args.indexOf('--session-id');
  const allocatedUuid = capturedCalls[0].args[sessionIdIndex + 1];
  assert.ok(allocatedUuid, 'UUID must be passed after --session-id');
  assert.equal(result.providerSessionId, allocatedUuid);
});

test('existing Claude conversation uses --resume', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'resumed' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines, { sessionId: extractSessionId(args) });
    },
  });

  await provider.startTurn({
    turnId: 'turn-2',
    providerSessionId: 'existing-uuid-12345',
    message: 'Follow-up message',
  });

  assert.equal(capturedCalls.length, 1);
  assert.ok(capturedCalls[0].args.includes('--resume'), 'Existing session must use --resume');
  assert.ok(!capturedCalls[0].args.includes('--session-id'), 'Existing session must not use --session-id');
  const resumeIndex = capturedCalls[0].args.indexOf('--resume');
  assert.equal(capturedCalls[0].args[resumeIndex + 1], 'existing-uuid-12345');
});

test('spawn failure before establishment does not call setProviderSessionId', async () => {
  let established = null;
  const provider = createClaudeAgentProvider({
    spawnProcess: () => {
      throw new Error('Immediate spawn failure');
    },
  });

  await assert.rejects(
    () => provider.startTurn({
      turnId: 'turn-spawn-fail',
      message: 'Hello',
      setProviderSessionId: id => { established = id; },
    }),
    { name: 'AiError' },
  );

  assert.equal(established, null);
});

test('provider process failure before session materialization rejects before establishment', async () => {
  let established = null;
  const provider = createClaudeAgentProvider({
    spawnProcess: () => createMockProcess([], { exitCode: 1 }),
  });

  await assert.rejects(
    () => provider.startTurn({
      turnId: 'turn-exit-fail',
      message: 'Hello',
      setProviderSessionId: id => { established = id; },
    }),
    { name: 'AiError' },
  );

  assert.equal(established, null);
});

test('successful establishment calls setProviderSessionId upon first stream event', async () => {
  let established = null;
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hello world' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => createMockProcess(lines, { sessionId: extractSessionId(args) }),
  });

  const result = await provider.startTurn({
    turnId: 'turn-success',
    message: 'Hello',
    setProviderSessionId: async id => { established = id; },
  });

  assert.ok(established);
  assert.equal(result.providerSessionId, established);
});

test('backend/provider adapter reconstruction between new chat and first message cannot turn first invocation into --resume', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'ok' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  // Adapter instance 1 created when draft opened: no state is stored
  createClaudeAgentProvider();

  // Server reloads / reconstructs adapter instance 2 before user sends first message:
  const provider2 = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines, { sessionId: extractSessionId(args) });
    },
  });

  // First message arrives without providerSessionId
  await provider2.startTurn({
    turnId: 'turn-reconstructed-1',
    message: 'User first prompt after restart',
  });

  assert.equal(capturedCalls.length, 1);
  assert.ok(capturedCalls[0].args.includes('--session-id'), 'Must still use --session-id after reconstruction');
  assert.ok(!capturedCalls[0].args.includes('--resume'), 'Must not accidentally use --resume');
});

test('failure before successful first Claude invocation does not cause retry to use --resume', async () => {
  const capturedCalls = [];
  let shouldFail = true;
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'success on retry' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      if (shouldFail) {
        throw new Error('Process spawn failure simulation');
      }
      return createMockProcess(lines, { sessionId: extractSessionId(args) });
    },
  });

  // Attempt 1 fails
  await assert.rejects(
    () => provider.startTurn({ turnId: 'turn-fail', message: 'Initial prompt' }),
    { name: 'AiError' },
  );
  assert.equal(capturedCalls.length, 1);
  assert.ok(capturedCalls[0].args.includes('--session-id'));

  // Attempt 2 (retry) succeeds
  shouldFail = false;
  const retryResult = await provider.startTurn({ turnId: 'turn-retry', message: 'Initial prompt' });
  assert.equal(capturedCalls.length, 2);
  assert.ok(capturedCalls[1].args.includes('--session-id'), 'Retry must still use --session-id');
  assert.ok(!capturedCalls[1].args.includes('--resume'), 'Retry must not use --resume');
  assert.ok(retryResult.providerSessionId);
});

test('externally attached existing providerSessionId still uses --resume', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'attached' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines, { sessionId: extractSessionId(args) });
    },
  });

  await provider.startTurn({
    turnId: 'turn-attached',
    providerSessionId: 'attached-external-uuid',
    message: 'Hello attached session',
  });

  assert.equal(capturedCalls.length, 1);
  assert.ok(capturedCalls[0].args.includes('--resume'));
  assert.equal(capturedCalls[0].args[capturedCalls[0].args.indexOf('--resume') + 1], 'attached-external-uuid');
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
    spawnProcess: (executable, args) => createMockProcess(lines, { sessionId: extractSessionId(args) }),
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

test('ClaudeAgentProvider intercepts AskUserQuestion tool_deferred and emits interaction with sanitized public ID', async () => {
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
    spawnProcess: (executable, args) => createMockProcess(lines, { sessionId: extractSessionId(args) }),
  });

  const result = await provider.startTurn({
    turnId: 'turn-q-1',
    providerSessionId: 'sess-q-1',
    message: 'Ask me',
  });

  assert.equal(result.isDeferred, true);
  assert.ok(result.interaction);
  assert.equal(result.interaction.kind, 'question');
  assert.equal(result.interaction.questions[0].question, 'Choose style?');
  assert.notEqual(result.interaction.id, 'toolu_q_01', 'Public interaction id must be decoupled from internal toolUseId');
  assert.ok(result.interaction.id.startsWith('int-'));
});

test('ClaudeAgentProvider supports turn cancellation', async () => {
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Chunk 1' } }),
  ];

  const abortController = new AbortController();
  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => createMockProcess(lines, { delayMs: 50, sessionId: extractSessionId(args) }),
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
