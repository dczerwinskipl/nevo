import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClaudeAgentProvider,
  createClaudeAgentProvider,
  CLAUDE_CAPABILITIES,
} from '../ai/claude-adapter.mjs';

function createMockProcess(stdoutLines = [], { exitCode = 0, delayMs = 5, sessionId, ignoreSignal = false } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new Writable({
    write(chunk, encoding, callback) { callback(); },
  });
  child.stdout = new Readable({
    read() {},
  });
  child.stderr = new Readable({
    read() {},
  });

  // Mirrors real Node child_process semantics closely enough for adapter tests: 'exit'
  // fires as soon as the process itself has terminated, 'close' once stdio finishes too.
  const finishKill = (signal) => {
    child.killed = true;
    child.killSignal = signal;
    child.signalCode = signal || null;
    child.exitCode = signal ? null : 0;
    child.emit('exit', child.exitCode, child.signalCode);
    child.emit('close', child.exitCode);
  };

  child.kill = (signal) => {
    // `ignoreSignal` simulates a process that doesn't respond to SIGINT (or on Windows,
    // where Node has no real signal delivery) — only an unsignaled forceful kill() works.
    if (ignoreSignal && signal) return true;
    setImmediate(() => finishKill(signal));
    return true;
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
    if (!child.killed) {
      child.stdout.push(null);
      child.exitCode = exitCode;
      child.emit('exit', exitCode, null);
      child.emit('close', exitCode);
    }
  });

  return child;
}

function extractSessionId(args = []) {
  const sIdx = args.indexOf('--session-id') !== -1 ? args.indexOf('--session-id') : args.indexOf('--resume');
  return sIdx !== -1 ? args[sIdx + 1] : undefined;
}

// A process that never completes on its own — only `kill()` ever terminates it. Used to
// test `cancelTurn`'s grace-period + forced-kill escalation in isolation from the normal
// stdout-streaming completion path.
function createHangingMockProcess({ ignoreSignal = false } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });

  const finishKill = (signal) => {
    child.killed = true;
    child.killSignal = signal;
    child.signalCode = signal || null;
    child.exitCode = signal ? null : 0;
    child.emit('exit', child.exitCode, child.signalCode);
    child.emit('close', child.exitCode);
  };

  child.kill = (signal) => {
    child.killCalls.push(signal);
    // `ignoreSignal` simulates a process that doesn't respond to SIGINT (or on Windows,
    // where Node has no real signal delivery) — only a subsequent unsignaled kill() works.
    if (ignoreSignal && signal) return true;
    setImmediate(() => finishKill(signal));
    return true;
  };

  return child;
}


test('ClaudeAgentProvider declares capabilities', () => {
  const provider = createClaudeAgentProvider();
  assert.equal(provider.descriptor.id, 'claude');
  assert.equal(provider.descriptor.capabilities.interactiveQuestions, true);
  assert.equal(provider.descriptor.capabilities.interactivePermissions, false);
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

for (const mode of ['ask', 'edit', 'agent']) {
  test(`Claude AskUserQuestion transport operates cleanly in ${mode} mode`, async () => {
    const expectedFlag = mode === 'ask' ? 'plan' : mode === 'edit' ? 'acceptEdits' : 'bypassPermissions';
    let capturedArgs = [];
    const lines = [
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: `Clarification needed in ${mode}` },
      }),
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'tool_deferred' },
        deferred_tool_use: {
          id: `toolu_q_${mode}`,
          name: 'AskUserQuestion',
          input: {
            questions: [
              { question: `Choose style in ${mode}?`, header: 'Style', multiSelect: false },
            ],
          },
        },
      }),
    ];

    const provider = createClaudeAgentProvider({
      spawnProcess: (executable, args) => {
        capturedArgs = args;
        return createMockProcess(lines, { sessionId: extractSessionId(args) });
      },
    });

    const result = await provider.startTurn({
      turnId: `turn-q-${mode}`,
      providerSessionId: `sess-q-${mode}`,
      message: `Ask me in ${mode}`,
      mode,
    });

    assert.equal(capturedArgs[capturedArgs.indexOf('--permission-mode') + 1], expectedFlag);
    assert.equal(result.isDeferred, true);
    assert.ok(result.interaction);
    assert.equal(result.interaction.kind, 'question');
    assert.equal(result.interaction.questions[0].question, `Choose style in ${mode}?`);
    assert.notEqual(result.interaction.id, `toolu_q_${mode}`, 'Public interaction id must be decoupled from internal toolUseId');
    assert.ok(result.interaction.id.startsWith('int-'));
  });
}

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

test('ClaudeAgentProvider reports availability correctly based on CLI probe', () => {
  const customProvider = createClaudeAgentProvider({
    probeExecutable: () => true,
  });
  assert.equal(customProvider.isAvailable().available, true);

  const missingProvider = new ClaudeAgentProvider({
    executable: 'claude',
    probeExecutable: () => false,
  });
  const avail = missingProvider.isAvailable();
  assert.equal(avail.available, false);
  assert.ok(avail.unavailableReason.includes('claude'));
});

test('ClaudeAgentProvider advertises supportedModes and defaultMode', () => {
  const provider = createClaudeAgentProvider();
  assert.deepEqual(provider.descriptor.supportedModes, ['ask', 'edit', 'agent']);
  assert.equal(provider.descriptor.defaultMode, 'edit');
});

test('ClaudeAgentProvider maps execution modes to exact CLI flags', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'ok' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines, { sessionId: extractSessionId(args) });
    },
  });

  // 1. Default (omitted) resolves to edit -> --permission-mode acceptEdits
  await provider.startTurn({
    turnId: 'turn-mode-default',
    providerSessionId: 'sess-1',
    message: 'hello',
  });
  assert.ok(capturedCalls[0].args.includes('--permission-mode'));
  assert.equal(capturedCalls[0].args[capturedCalls[0].args.indexOf('--permission-mode') + 1], 'acceptEdits');

  // 2. Explicit 'ask' resolves to plan -> --permission-mode plan
  await provider.startTurn({
    turnId: 'turn-mode-ask',
    providerSessionId: 'sess-1',
    message: 'analyze this',
    mode: 'ask',
  });
  assert.equal(capturedCalls[1].args[capturedCalls[1].args.indexOf('--permission-mode') + 1], 'plan');

  // 3. Explicit 'edit' resolves to acceptEdits -> --permission-mode acceptEdits
  await provider.startTurn({
    turnId: 'turn-mode-edit',
    providerSessionId: 'sess-1',
    message: 'edit this',
    mode: 'edit',
  });
  assert.equal(capturedCalls[2].args[capturedCalls[2].args.indexOf('--permission-mode') + 1], 'acceptEdits');

  // 4. Explicit 'agent' resolves to bypassPermissions -> --permission-mode bypassPermissions
  await provider.startTurn({
    turnId: 'turn-mode-agent',
    providerSessionId: 'sess-1',
    message: 'run all',
    mode: 'agent',
  });
  assert.equal(capturedCalls[3].args[capturedCalls[3].args.indexOf('--permission-mode') + 1], 'bypassPermissions');
});

for (const mode of ['ask', 'edit', 'agent']) {
  test(`Claude respondInteraction preserves original mode '${mode}' on resumed invocation`, async () => {
    const expectedFlag = mode === 'ask' ? 'plan' : mode === 'edit' ? 'acceptEdits' : 'bypassPermissions';
    const capturedArgs = [];
    const deferredLines = [
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'tool_deferred' },
        deferred_tool_use: {
          id: `toolu_q_${mode}`,
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Choose?', header: 'Style', multiSelect: false }] },
        },
      }),
    ];
    const resumedLines = [
      JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Resumed done' } }),
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    ];

    let spawnCount = 0;
    const provider = createClaudeAgentProvider({
      spawnProcess: (executable, args) => {
        spawnCount += 1;
        capturedArgs.push(args);
        if (spawnCount === 1) return createMockProcess(deferredLines, { sessionId: extractSessionId(args) });
        return createMockProcess(resumedLines, { sessionId: extractSessionId(args) });
      },
    });

    const firstTurn = await provider.startTurn({
      turnId: `turn-resp-${mode}`,
      providerSessionId: `sess-resp-${mode}`,
      message: `Prompt in ${mode}`,
      mode,
    });

    assert.equal(firstTurn.isDeferred, true);
    assert.equal(capturedArgs[0][capturedArgs[0].indexOf('--permission-mode') + 1], expectedFlag);

    await provider.respondInteraction({
      turnId: `turn-resp-${mode}`,
      providerSessionId: `sess-resp-${mode}`,
      interactionId: firstTurn.interaction.id,
      interaction: firstTurn.interaction,
      response: { answers: [{ questionId: firstTurn.interaction.questions[0].id, value: 'Selected' }] },
      mode,
    });

    assert.equal(capturedArgs.length, 2);
    assert.equal(capturedArgs[1][capturedArgs[1].indexOf('--permission-mode') + 1], expectedFlag);
  });
}

test('Claude ask mode behavioral guarantee: offline provider evidence reflects that mutation is blocked in plan mode', async () => {
  const lines = [
    JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: 'Plan mode active: inspecting codebase. File writes are not permitted in plan mode.' },
    }),
    JSON.stringify({
      type: 'tool_use',
      id: 'tool_edit_01',
      name: 'Edit',
      input: { path: 'source.ts', new_string: 'mutated' },
    }),
    JSON.stringify({
      type: 'tool_result',
      tool_use_id: 'tool_edit_01',
      is_error: true,
      content: 'Permission denied: file modification is disabled in plan mode.',
    }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
  ];

  let spawnedArgs = null;
  const provider = createClaudeAgentProvider({
    spawnProcess: (executable, args) => {
      spawnedArgs = args;
      return createMockProcess(lines, { sessionId: extractSessionId(args) });
    },
  });

  const textDeltas = [];
  const toolsStarted = [];
  const toolsCompleted = [];

  const result = await provider.startTurn({
    turnId: 'turn-ask-behavior',
    providerSessionId: 'sess-ask-1',
    message: 'Please review architecture',
    mode: 'ask',
    emitTextDelta: (delta) => textDeltas.push(delta),
    emitToolStarted: (tool) => toolsStarted.push(tool),
    emitToolCompleted: (tool) => toolsCompleted.push(tool),
  });

  assert.ok(spawnedArgs.includes('--permission-mode'));
  assert.equal(spawnedArgs[spawnedArgs.indexOf('--permission-mode') + 1], 'plan');
  assert.ok(textDeltas.join('').includes('Plan mode active'));
  assert.equal(toolsStarted.length, 1);
  assert.equal(toolsStarted[0].toolName, 'Edit');
  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].toolId, 'tool_edit_01');
  assert.ok(toolsCompleted[0].output?.includes('Permission denied'));
  assert.equal(result.status, 'completed');
});

test('cancelTurn stops at SIGINT when the process responds within the grace period', async () => {
  const child = createHangingMockProcess();
  const provider = createClaudeAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 200,
  });

  let operation;
  const startPromise = provider.startTurn({
    turnId: 'turn-cancel-graceful',
    message: 'hello',
    setOperation: op => { operation = op; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(operation, 'setOperation must be called before cancelTurn can be exercised');

  await provider.cancelTurn({ operation });
  assert.deepEqual(child.killCalls, ['SIGINT']);
  await assert.rejects(startPromise, { code: 'AI_TURN_CANCELLED' });
});

test('cancelTurn escalates to a forceful, unsignaled kill when SIGINT is ignored past the grace period', async () => {
  const child = createHangingMockProcess({ ignoreSignal: true });
  const provider = createClaudeAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 20,
  });

  let operation;
  const startPromise = provider.startTurn({
    turnId: 'turn-cancel-escalate',
    message: 'hello',
    setOperation: op => { operation = op; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(operation, 'setOperation must be called before cancelTurn can be exercised');

  await provider.cancelTurn({ operation });
  assert.deepEqual(child.killCalls, ['SIGINT', undefined]);
  await assert.rejects(startPromise, { code: 'AI_TURN_CANCELLED' });
});
