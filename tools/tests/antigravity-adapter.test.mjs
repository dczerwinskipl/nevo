import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  AntigravityAgentProvider,
  ANTIGRAVITY_CAPABILITIES,
  extractFinalResponse,
  rawCaptureSessionDirectory,
} from '../ai/antigravity-adapter.mjs';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { CapabilityNotSupportedError } from '../ai/contracts.mjs';

function createAntigravityAgentProvider(options = {}) {
  return new AntigravityAgentProvider({
    mappingFilePath: null,
    rawCaptureEnabled: false,
    ...options,
  });
}

function createMockProcess(stdoutLines = [], { exitCode = 0, delayMs = 5, events = null } = {}) {
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
    if (Array.isArray(events)) {
      for (const ev of events) {
        if (child.killed) break;
        if (ev.stream === 'stderr') {
          child.stderr.push(`${ev.line}\n`);
        } else {
          child.stdout.push(`${ev.line}\n`);
        }
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      }
    } else {
      for (const line of stdoutLines) {
        if (child.killed) break;
        child.stdout.push(`${line}\n`);
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      }
    }
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit('close', exitCode);
  });

  return child;
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
    child.exitCode = signal === 'SIGKILL' ? null : 0;
    child.emit('exit', child.exitCode, child.signalCode);
    child.emit('close', child.exitCode);
  };

  child.kill = (signal) => {
    child.killCalls.push(signal);
    // `ignoreSignal` simulates a process that doesn't respond to SIGINT — only subsequent SIGKILL terminates it.
    if (ignoreSignal && signal === 'SIGINT') return true;
    setImmediate(() => finishKill(signal));
    return true;
  };

  return child;
}

test('AntigravityAgentProvider declares honest capabilities', () => {
  const provider = createAntigravityAgentProvider();
  assert.equal(provider.descriptor.id, 'antigravity');
  assert.equal(provider.descriptor.capabilities.interactivePermissions, false);
  assert.equal(provider.descriptor.capabilities.interactiveQuestions, true);
  assert.equal(provider.descriptor.capabilities.interactiveConfirmations, false);
  assert.equal(provider.descriptor.capabilities.resumeSession, true);
  assert.equal(provider.descriptor.capabilities.cancelTurn, true);
  assert.equal(provider.descriptor.capabilities.toolCalls, true);
  assert.equal(provider.descriptor.capabilities.reasoning, true);
  assert.equal(provider.descriptor.capabilities.usage, true);
});

test('AntigravityAgentProvider throws CapabilityNotSupportedError for permissions', async () => {
  const provider = createAntigravityAgentProvider();
  await assert.rejects(
    () => provider.respondInteraction('sess-1', 'int-1', { kind: 'permission', decision: 'allow' }),
    err => {
      assert.ok(err instanceof CapabilityNotSupportedError);
      assert.equal(err.provider, 'antigravity');
      assert.equal(err.capability, 'interactivePermissions');
      return true;
    }
  );
});

test('new conversation spawns with stream-json input format and sets providerSessionId upon init', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'agy-conv-123' }),
    JSON.stringify({ type: 'text.delta', delta: 'Hello from Antigravity' }),
    JSON.stringify({ type: 'done', result: 'Hello from Antigravity' }),
  ];

  const provider = createAntigravityAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines);
    },
  });

  let allocatedSessionId = null;
  const deltas = [];

  const result = await provider.startTurn({
    turnId: 'turn-1',
    message: 'Hello',
    setProviderSessionId: (id) => { allocatedSessionId = id; },
    emitTextDelta: (d) => deltas.push(d),
  });

  assert.equal(result.status, 'completed');
  assert.equal(allocatedSessionId, 'agy-conv-123');
  assert.equal(result.providerSessionId, 'agy-conv-123');
  assert.ok(capturedCalls.length === 1);
  assert.ok(capturedCalls[0].executable.includes('agy'));
  assert.ok(capturedCalls[0].args.includes('--print'));
  assert.ok(deltas.includes('Hello from Antigravity'));
});

test('existing conversation spawns with --conversation', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'text.delta', delta: 'Continuing session' }),
    JSON.stringify({ type: 'result' }),
  ];

  const provider = createAntigravityAgentProvider({
    materializedSessions: ['agy-conv-123'],
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines);
    },
  });

  const result = await provider.startTurn({
    turnId: 'turn-2',
    providerSessionId: 'agy-conv-123',
    message: 'Next prompt',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.providerSessionId, 'agy-conv-123');
  assert.ok(capturedCalls.length === 1);
  assert.ok(capturedCalls[0].args.includes('--conversation'));
  assert.ok(capturedCalls[0].args.includes('agy-conv-123'));
});

test('multi-turn continuation maps dashboard session ID to agy conversation ID across turns', async () => {
  const capturedCalls = [];
  const turn1Lines = [
    JSON.stringify({ event: 'init', conversation_id: 'agy-allocated-999' }),
    JSON.stringify({ event: 'step_update', step_update: { text_delta: 'Turn 1 done' } }),
    JSON.stringify({ event: 'result', result: { response: 'Turn 1 done' } }),
  ];
  const turn2Lines = [
    JSON.stringify({ event: 'step_update', step_update: { text_delta: 'Turn 2 done' } }),
    JSON.stringify({ event: 'result', result: { response: 'Turn 2 done' } }),
  ];

  const provider = createAntigravityAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      const lines = capturedCalls.length === 1 ? turn1Lines : turn2Lines;
      return createMockProcess(lines);
    },
  });

  // Turn 1 with dashboard-generated session ID
  let allocatedId = null;
  await provider.startTurn({
    turnId: 'turn-1',
    providerSessionId: 'dashboard-uuid-111',
    message: 'First turn',
    setProviderSessionId: (id) => { allocatedId = id; },
  });

  assert.equal(allocatedId, 'agy-allocated-999');
  assert.ok(!capturedCalls[0].args.includes('--conversation'), 'Turn 1 must not pass --conversation');

  // Turn 2 with same dashboard-generated session ID
  await provider.startTurn({
    turnId: 'turn-2',
    providerSessionId: 'dashboard-uuid-111',
    message: 'Second turn',
  });

  assert.ok(capturedCalls[1].args.includes('--conversation'), 'Turn 2 must pass --conversation');
  assert.ok(capturedCalls[1].args.includes('agy-allocated-999'), 'Turn 2 must resume agy-allocated-999');
});

test('maps reasoning, tool calls, and usage events', async () => {
  const lines = [
    JSON.stringify({ type: 'reasoning.delta', reasoning: 'Thinking step 1' }),
    JSON.stringify({ type: 'tool.started', toolId: 't1', toolName: 'ReadFile', input: { path: 'file.txt' } }),
    JSON.stringify({ type: 'tool.completed', toolId: 't1', output: 'content' }),
    JSON.stringify({ type: 'text.delta', delta: 'Here is the file' }),
    JSON.stringify({ type: 'usage', tokensIn: 100, tokensOut: 50, cost: 0.002 }),
    JSON.stringify({ type: 'done' }),
  ];

  const reasonings = [];
  const toolsStarted = [];
  const toolsCompleted = [];
  const texts = [];
  let usage = null;

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  await provider.startTurn({
    turnId: 'turn-3',
    providerSessionId: 'agy-conv-456',
    message: 'Inspect file',
    emitReasoningDelta: (r) => reasonings.push(r),
    emitToolStarted: (t) => toolsStarted.push(t),
    emitToolCompleted: (t) => toolsCompleted.push(t),
    emitTextDelta: (t) => texts.push(t),
    emitUsageUpdated: (u) => { usage = u; },
  });

  assert.deepEqual(reasonings, ['Thinking step 1']);
  assert.equal(toolsStarted.length, 1);
  assert.equal(toolsStarted[0].toolName, 'ReadFile');
  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].output, 'content');
  assert.deepEqual(texts, ['Here is the file']);
  assert.deepEqual(usage, { tokensIn: 100, tokensOut: 50, cost: 0.002 });
});

test('supports turn cancellation via cancelTurn', async () => {
  const child = createHangingMockProcess();

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 200,
  });

  const turnPromise = provider.startTurn({
    turnId: 'turn-cancel',
    providerSessionId: 'sess-c',
    message: 'Long query',
  });

  const cancelResult = await provider.cancelTurn({ turnId: 'turn-cancel', providerSessionId: 'sess-c' });
  assert.equal(cancelResult.cancelled, true);
  assert.deepEqual(child.killCalls, ['SIGINT']);

  await assert.rejects(turnPromise, err => err.code === 'AI_TURN_CANCELLED');
});

test('cancelTurn escalates to a forceful SIGKILL when SIGINT is ignored past the grace period', async () => {
  const child = createHangingMockProcess({ ignoreSignal: true });

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 20,
  });

  const turnPromise = provider.startTurn({
    turnId: 'turn-cancel-escalate',
    providerSessionId: 'sess-escalate',
    message: 'Long query',
  });

  const cancelResult = await provider.cancelTurn({ turnId: 'turn-cancel-escalate', providerSessionId: 'sess-escalate' });
  assert.equal(cancelResult.cancelled, true);
  assert.deepEqual(child.killCalls, ['SIGINT', 'SIGKILL']);

  await assert.rejects(turnPromise, err => err.code === 'AI_TURN_CANCELLED');
});

test('can be registered and retrieved in AiAdapterRegistry', () => {
  const provider = createAntigravityAgentProvider();
  const registry = createAiAdapterRegistry([provider]);
  assert.ok(registry.has('antigravity'));
  assert.equal(registry.get('antigravity').descriptor.label, 'Antigravity / Gemini');
});

test('AntigravityAgentProvider reports availability correctly based on CLI probe', () => {
  const customProvider = createAntigravityAgentProvider({
    probeExecutable: () => true,
  });
  assert.equal(customProvider.isAvailable().available, true);

  const missingProvider = new AntigravityAgentProvider({
    executable: 'agy',
    probeExecutable: () => false,
  });
  const avail = missingProvider.isAvailable();
  assert.equal(avail.available, false);
  assert.ok(avail.unavailableReason.includes('agy'));
});

test('AntigravityAgentProvider advertises supportedModes and defaultMode', () => {
  const provider = createAntigravityAgentProvider();
  assert.deepEqual(provider.descriptor.supportedModes, ['ask', 'edit', 'agent']);
  assert.equal(provider.descriptor.defaultMode, 'edit');
});

test('AntigravityAgentProvider maps execution modes to exact CLI flags', async () => {
  const capturedCalls = [];
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-1' }),
    JSON.stringify({ type: 'done', result: 'ok' }),
  ];

  const provider = createAntigravityAgentProvider({
    spawnProcess: (executable, args) => {
      capturedCalls.push({ executable, args });
      return createMockProcess(lines);
    },
  });

  // 1. Default (omitted) resolves to edit -> --mode=accept-edits
  await provider.startTurn({
    turnId: 'turn-mode-default',
    providerSessionId: 'conv-1',
    message: 'hello',
  });
  assert.ok(capturedCalls[0].args.includes('--mode=accept-edits'));
  assert.ok(!capturedCalls[0].args.includes('--dangerously-skip-permissions'));

  // 2. Explicit 'ask' resolves to --mode=plan
  await provider.startTurn({
    turnId: 'turn-mode-ask',
    providerSessionId: 'conv-1',
    message: 'analyze this',
    mode: 'ask',
  });
  assert.ok(capturedCalls[1].args.includes('--mode=plan'));
  assert.ok(!capturedCalls[1].args.includes('--dangerously-skip-permissions'));

  // 3. Explicit 'edit' resolves to --mode=accept-edits
  await provider.startTurn({
    turnId: 'turn-mode-edit',
    providerSessionId: 'conv-1',
    message: 'edit this',
    mode: 'edit',
  });
  assert.ok(capturedCalls[2].args.includes('--mode=accept-edits'));
  assert.ok(!capturedCalls[2].args.includes('--dangerously-skip-permissions'));

  // 4. Explicit 'agent' resolves to --mode=accept-edits --dangerously-skip-permissions
  await provider.startTurn({
    turnId: 'turn-mode-agent',
    providerSessionId: 'conv-1',
    message: 'run all',
    mode: 'agent',
  });
  assert.ok(capturedCalls[3].args.includes('--mode=accept-edits'));
  assert.ok(capturedCalls[3].args.includes('--dangerously-skip-permissions'));
});

test('Antigravity ask mode contract simulation: adapter correctly processes blocked mutation tool failure in plan mode', async () => {
  // Synthetic inline stream simulating adapter handling of tool-execution rejection in plan mode.
  // Note: This is an offline protocol/adapter contract simulation, not captured native CLI provider evidence.
  // Real native CLI no-write guarantees are verified via manual discovery probes.
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-ask' }),
    JSON.stringify({
      type: 'tool.started',
      toolId: 'tool_write_01',
      toolName: 'write_file',
      input: { path: 'source.ts', content: 'mutated' },
    }),
    JSON.stringify({
      type: 'tool.completed',
      toolId: 'tool_write_01',
      status: 'failed',
      output: 'Modification blocked: Antigravity plan mode is read-only.',
    }),
    JSON.stringify({ type: 'text.delta', delta: 'Plan mode analysis complete. File modification was blocked.' }),
    JSON.stringify({ type: 'done' }),
  ];

  let spawnedArgs = null;
  const provider = createAntigravityAgentProvider({
    spawnProcess: (executable, args) => {
      spawnedArgs = args;
      return createMockProcess(lines);
    },
  });

  const textDeltas = [];
  const toolsStarted = [];
  const toolsCompleted = [];

  const result = await provider.startTurn({
    turnId: 'turn-ask-behavior',
    providerSessionId: 'conv-ask',
    message: 'Review codebase and try edit',
    mode: 'ask',
    emitTextDelta: (d) => textDeltas.push(d),
    emitToolStarted: (t) => toolsStarted.push(t),
    emitToolCompleted: (t) => toolsCompleted.push(t),
  });

  assert.ok(spawnedArgs.includes('--mode=plan'));
  assert.ok(!spawnedArgs.includes('--dangerously-skip-permissions'));
  assert.equal(textDeltas.join(''), 'Plan mode analysis complete. File modification was blocked.');
  assert.equal(toolsStarted.length, 1);
  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].status, 'failed');
  assert.ok(toolsCompleted[0].output.includes('Modification blocked'));
  assert.equal(result.status, 'completed');
});

test('Antigravity cancelTurn retains active operation in state until cancellation completes', async () => {
  let finishSignal = null;
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.stdin = new Writable({ write(chunk, encoding, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });

  child.kill = (signal) => {
    child.killCalls.push(signal);
    finishSignal = signal;
    return true;
  };

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 200,
  });

  const startPromise = provider.startTurn({
    turnId: 'turn-cancel-hold',
    providerSessionId: 'sess-hold',
    message: 'hello',
  });
  await new Promise(resolve => setImmediate(resolve));

  let cancelCompleted = false;
  const cancelPromise = provider.cancelTurn({ turnId: 'turn-cancel-hold', providerSessionId: 'sess-hold' }).then(res => {
    cancelCompleted = true;
    return res;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelCompleted, false, 'cancelTurn must not report completion before process exits');

  // Trigger process exit
  child.exitCode = 0;
  child.signalCode = finishSignal;
  child.emit('exit', 0, finishSignal);
  child.emit('close', 0);

  const res = await cancelPromise;
  assert.equal(res.cancelled, true);
  assert.equal(cancelCompleted, true);
  await assert.rejects(startPromise, { code: 'AI_TURN_CANCELLED' });
});

test('Antigravity cancelTurn bounded cancellation fails cleanly when child ignores all signals', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.stdin = new Writable({ write(chunk, encoding, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return true;
  };

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 15,
    forceGraceMs: 15,
  });

  const startPromise = provider.startTurn({
    turnId: 'turn-cancel-unresponsive-agy',
    providerSessionId: 'sess-unresponsive',
    message: 'hello',
  });
  await new Promise(resolve => setImmediate(resolve));

  await assert.rejects(
    () => provider.cancelTurn({ turnId: 'turn-cancel-unresponsive-agy', providerSessionId: 'sess-unresponsive' }),
    err => err.code === 'AI_PROCESS_TERMINATION_FAILED'
  );
  assert.deepEqual(child.killCalls, ['SIGINT', 'SIGKILL']);
});

// owner-decisions.md D6, required scenario: Antigravity non-zero exit while a tool is active.
test('Antigravity non-zero process exit resolves a still-active tool call to failed, never the hardcoded completed', async () => {
  const lines = [
    JSON.stringify({ type: 'tool.started', toolId: 'tool-exit', toolName: 'Bash', input: { command: 'flaky' } }),
  ];
  const toolsCompleted = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines, { exitCode: 1 }),
  });

  await assert.rejects(
    provider.startTurn({
      turnId: 'turn-exit-tool',
      providerSessionId: 'sess-exit-tool',
      message: 'go',
      emitToolCompleted: (t) => toolsCompleted.push(t),
    }),
    err => err.code === 'AI_PROVIDER_EXIT_ERROR',
  );

  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].toolId, 'tool-exit');
  assert.equal(toolsCompleted[0].status, 'failed');
});

// owner-decisions.md D6, required scenario: Antigravity cancellation while a tool is active.
test('Antigravity cancellation resolves a still-active tool call to failed only after the cancellation check runs', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.stdin = new Writable({ write(chunk, encoding, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  let finishSignal = null;
  child.kill = (signal) => {
    child.killCalls.push(signal);
    finishSignal = signal;
    return true;
  };

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 200,
  });

  const toolsCompleted = [];
  const startPromise = provider.startTurn({
    turnId: 'turn-cancel-tool',
    providerSessionId: 'sess-cancel-tool',
    message: 'long query',
    emitToolCompleted: (t) => toolsCompleted.push(t),
  });
  await new Promise(resolve => setImmediate(resolve));

  child.stdout.push(`${JSON.stringify({ type: 'tool.started', toolId: 'tool-cancel', toolName: 'Bash', input: { command: 'long-running' } })}\n`);
  await new Promise(resolve => setImmediate(resolve));

  let cancelCompleted = false;
  const cancelPromise = provider.cancelTurn({ turnId: 'turn-cancel-tool', providerSessionId: 'sess-cancel-tool' }).then(res => {
    cancelCompleted = true;
    return res;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelCompleted, false, 'cancelTurn must not report completion before the process exits');
  assert.equal(toolsCompleted.length, 0, 'no tool.completed must be emitted before the close handler evaluates cancellation');

  child.exitCode = 0;
  child.signalCode = finishSignal;
  child.emit('exit', 0, finishSignal);
  child.emit('close', 0);

  const cancelResult = await cancelPromise;
  assert.equal(cancelResult.cancelled, true);
  await assert.rejects(startPromise, err => err.code === 'AI_TURN_CANCELLED');

  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].toolId, 'tool-cancel');
  assert.equal(toolsCompleted[0].status, 'failed');
});

// ── Regression tests: Antigravity terminal result extraction & lifecycle ──────────

// Requirement 1 & 2: Final assistant prose from result.response without preceding text_delta.
test('Antigravity extracts final assistant response from result.response without earlier text streaming', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-final-resp' }),
    JSON.stringify({ type: 'tool.started', toolId: 't1', toolName: 'Read', input: { path: 'file.ts' } }),
    JSON.stringify({ type: 'tool.completed', toolId: 't1', output: 'file contents' }),
    JSON.stringify({
      event: 'result',
      result: {
        response: 'Final summary after tools completed.',
      },
    }),
  ];

  const textDeltas = [];
  const toolsCompleted = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const result = await provider.startTurn({
    turnId: 'turn-final-resp',
    providerSessionId: 'conv-final-resp',
    message: 'Read file and summarize',
    emitTextDelta: (t) => textDeltas.push(t),
    emitToolCompleted: (t) => toolsCompleted.push(t),
  });

  assert.equal(result.status, 'completed');
  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].status, 'completed');
  assert.deepEqual(textDeltas, ['Final summary after tools completed.'], 'final prose must be emitted exactly once');
});

// Requirement 3: Avoid duplicate final prose when streaming text matches terminal result.
test('Antigravity deduplicates final prose when both text_delta and result.response carry the same text', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-dedup' }),
    JSON.stringify({ event: 'step_update', step_update: { text_delta: 'Final summary prose' } }),
    JSON.stringify({
      event: 'result',
      result: {
        response: 'Final summary prose',
      },
    }),
  ];

  const textDeltas = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const result = await provider.startTurn({
    turnId: 'turn-dedup',
    providerSessionId: 'conv-dedup',
    message: 'Summarize',
    emitTextDelta: (t) => textDeltas.push(t),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(textDeltas, ['Final summary prose'], 'must not emit duplicate prose');
});

// Requirement 3: Partial streaming followed by complete final response emits only suffix.
test('Antigravity handles partial streaming prefix followed by complete final response without duplication', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-partial' }),
    JSON.stringify({ event: 'step_update', step_update: { text_delta: 'Podsumowując: ' } }),
    JSON.stringify({
      event: 'result',
      result: {
        response: 'Podsumowując: wszystko wykonane pomyślnie.',
      },
    }),
  ];

  const textDeltas = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const result = await provider.startTurn({
    turnId: 'turn-partial',
    providerSessionId: 'conv-partial',
    message: 'Summarize',
    emitTextDelta: (t) => textDeltas.push(t),
  });

  assert.equal(result.status, 'completed');
  assert.equal(textDeltas.join(''), 'Podsumowując: wszystko wykonane pomyślnie.');
  assert.deepEqual(textDeltas, ['Podsumowując: ', 'wszystko wykonane pomyślnie.']);
});

// Requirement 4: Terminal provider event resolves startTurn immediately, not waiting for child close.
test('Antigravity turn completes immediately upon authoritative result event even if child process close is delayed', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.stdin = new Writable({ write(chunk, encoding, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
  });

  const textDeltas = [];
  const startPromise = provider.startTurn({
    turnId: 'turn-early-resolve',
    providerSessionId: 'sess-early-resolve',
    message: 'hello',
    emitTextDelta: (t) => textDeltas.push(t),
  });

  // Feed stdout lines
  child.stdout.push(`${JSON.stringify({ type: 'init', conversation_id: 'sess-early-resolve' })}\n`);
  child.stdout.push(`${JSON.stringify({ event: 'result', result: { response: 'Turn finished immediately' } })}\n`);

  // Allow microtasks/promises to process
  await new Promise(resolve => setTimeout(resolve, 20));

  // startPromise must resolve NOW without child emitting 'close'
  let resolved = false;
  startPromise.then(() => { resolved = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(resolved, true, 'startTurn must resolve upon authoritative result event without waiting for process close');
  assert.deepEqual(textDeltas, ['Turn finished immediately']);

  // Emitting close later must not throw or cause duplicate completion
  child.exitCode = 0;
  child.emit('close', 0);
  const turnResult = await startPromise;
  assert.equal(turnResult.status, 'completed');
});

// Requirement 5: A failed tool does not suppress final assistant response.
test('Antigravity preserves final assistant response even when an earlier tool in the turn failed', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-tool-fail' }),
    JSON.stringify({ type: 'tool.started', toolId: 't1', toolName: 'Read', input: { path: 'missing.ts' } }),
    JSON.stringify({ type: 'tool.completed', toolId: 't1', status: 'failed', output: 'File not found' }),
    JSON.stringify({
      event: 'result',
      result: {
        response: 'Plik nie istnieje, ale znalazłem plik zastępczy.',
      },
    }),
  ];

  const textDeltas = [];
  const toolsCompleted = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const result = await provider.startTurn({
    turnId: 'turn-tool-fail',
    providerSessionId: 'conv-tool-fail',
    message: 'Read file',
    emitTextDelta: (t) => textDeltas.push(t),
    emitToolCompleted: (t) => toolsCompleted.push(t),
  });

  assert.equal(result.status, 'completed');
  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].status, 'failed', 'tool remains failed');
  assert.deepEqual(textDeltas, ['Plik nie istnieje, ale znalazłem plik zastępczy.'], 'final assistant message must be preserved');
});

test('extractFinalResponse supports only proven provider shapes and rejects arbitrary property guesses', () => {
  // Proven shapes
  assert.equal(extractFinalResponse({ result: 'plain string result' }), 'plain string result');
  assert.equal(extractFinalResponse({ type: 'done', result: 'done result' }), 'done result');
  assert.equal(extractFinalResponse({ event: 'result', result: { response: 'object result response' } }), 'object result response');
  assert.equal(extractFinalResponse({ response: 'direct response' }), 'direct response');

  // Unproven / generic metadata fields that must NOT be treated as assistant prose
  assert.equal(extractFinalResponse({ result: { text: 'some text' } }), null);
  assert.equal(extractFinalResponse({ result: { content: 'some content' } }), null);
  assert.equal(extractFinalResponse({ result: { message: 'some message' } }), null);
  assert.equal(extractFinalResponse({ result: { summary: 'some summary' } }), null);
  assert.equal(extractFinalResponse({ text: 'top level text' }), null);
  assert.equal(extractFinalResponse({ content: 'top level content' }), null);
  assert.equal(extractFinalResponse({ message: 'top level message' }), null);
  assert.equal(extractFinalResponse({ summary: 'top level summary' }), null);
  assert.equal(extractFinalResponse({ step_update: { response: 'step update' } }), null);
  assert.equal(extractFinalResponse({ result: { other: 123 } }), null);
  assert.equal(extractFinalResponse(null), null);
  assert.equal(extractFinalResponse('not an object'), null);
});

test('Antigravity lifecycle: authoritative terminal result resolves immediately, strictly cuts off trailing events, retains process ownership until exit, and prevents duplicate completion', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.stdin = new Writable({ write(chunk, encoding, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = (signal) => {
    child.killCalls.push(signal);
    child.killed = true;
    return true;
  };

  let capturedOperation = null;
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
  });

  const textDeltas = [];
  const toolsStarted = [];
  const reasonings = [];
  const usages = [];

  const startPromise = provider.startTurn({
    turnId: 'turn-cutoff-test',
    providerSessionId: 'sess-cutoff',
    message: 'run test',
    emitTextDelta: (t) => textDeltas.push(t),
    emitToolStarted: (t) => toolsStarted.push(t),
    emitReasoningDelta: (r) => reasonings.push(r),
    emitUsageUpdated: (u) => usages.push(u),
    setOperation: (op) => { capturedOperation = op; },
  });

  // 1. Child emits init
  child.stdout.push(`${JSON.stringify({ type: 'init', conversation_id: 'sess-cutoff' })}\n`);

  // 2. Child emits authoritative result
  child.stdout.push(`${JSON.stringify({ event: 'result', result: { response: 'done' } })}\n`);

  // Allow microtasks to resolve turn
  await new Promise(resolve => setTimeout(resolve, 20));

  // Assert: startTurn resolves immediately at result
  let resolved = false;
  startPromise.then(() => { resolved = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(resolved, true, 'startTurn must resolve immediately upon result');
  assert.deepEqual(textDeltas, ['done'], '"done" must be emitted exactly once');

  // Assert: child is still alive and remains tracked under deterministic cleanup ownership
  assert.ok(capturedOperation, 'operation was tracked');
  assert.equal(capturedOperation.child, child);
  assert.equal(capturedOperation.isResolved, true);

  // 3. Child emits trailing stdout events while still alive
  child.stdout.push(`${JSON.stringify({ type: 'text.delta', delta: 'trailing text after done' })}\n`);
  child.stdout.push(`${JSON.stringify({ type: 'tool.started', toolId: 'tool-trailing', toolName: 'Bash', input: { cmd: 'ls' } })}\n`);
  child.stdout.push(`${JSON.stringify({ type: 'reasoning.delta', reasoning: 'trailing thought' })}\n`);
  child.stdout.push(`${JSON.stringify({ type: 'usage', tokensIn: 500, tokensOut: 500 })}\n`);

  // 4. Child emits close
  child.exitCode = 0;
  child.emit('close', 0);

  const turnResult = await startPromise;
  assert.equal(turnResult.status, 'completed');
  assert.equal(textDeltas.length, 1);
});


test('Antigravity bounded graceful termination terminates child process if it remains alive indefinitely after result', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.stdin = new Writable({ write(chunk, encoding, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = (signal) => {
    child.killCalls.push(signal);
    child.exitCode = 0;
    setImmediate(() => child.emit('close', 0));
    return true;
  };

  const provider = createAntigravityAgentProvider({
    spawnProcess: () => child,
    cancelGraceMs: 30,
    forceGraceMs: 30,
  });

  const turnPromise = provider.startTurn({
    turnId: 'turn-hanging-child',
    providerSessionId: 'sess-hanging',
    message: 'hello',
  });

  child.stdout.push(`${JSON.stringify({ type: 'init', conversation_id: 'sess-hanging' })}\n`);
  child.stdout.push(`${JSON.stringify({ event: 'result', result: { response: 'done' } })}\n`);

  const result = await turnPromise;
  assert.equal(result.status, 'completed');

  // Wait for post-result timeout to fire
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.ok(child.killCalls.includes('SIGINT'), 'post-result timer must trigger bounded graceful termination');
});

test('Antigravity raw capture: known JSON events persist exact payload with envelope metadata and turnId', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-raw-json-'));
  try {
    const rawEvents = [
      { type: 'init', conversation_id: 'conv-json-test' },
      { event: 'step_update', step_type: 'tool', tool_name: 'bash', state: 'ACTIVE', input: { command: 'npm test' } },
      { event: 'step_update', step_type: 'tool', tool_name: 'bash', state: 'DONE', output: 'Tests passed' },
      { event: 'result', result: { response: 'All good' } },
    ];
    const stdoutLines = rawEvents.map(e => JSON.stringify(e));

    const child = createMockProcess(stdoutLines);
    const provider = createAntigravityAgentProvider({
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });

    const turnId = 'turn-json-test-123';
    const result = await provider.startTurn({
      turnId,
      providerSessionId: 'conv-json-test',
      message: 'run test',
    });
    assert.equal(result.status, 'completed');

    await provider.flushRawCapture('conv-json-test');

    const captureFile = provider.getRawCapturePath('conv-json-test');
    assert.ok(captureFile.startsWith(tmpDir), 'Capture file must reside within tmpDir');
    // Verify direct correlation: safe ID maps directly to folder name
    assert.equal(captureFile, join(tmpDir, 'conv-json-test', 'raw.ndjson'));

    const content = await readFile(captureFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    assert.equal(lines.length, rawEvents.length);
    for (let i = 0; i < rawEvents.length; i++) {
      assert.equal(lines[i].stream, 'stdout');
      assert.equal(lines[i].turnId, turnId);
      assert.equal(lines[i].providerSessionId, 'conv-json-test', 'Envelope must preserve providerSessionId');
      assert.ok(lines[i].capturedAt, 'capturedAt must be present');
      assert.deepEqual(lines[i].raw, rawEvents[i], 'raw payload must match exact provider object');
    }

    // Verify session.json metadata
    const metadataFile = join(tmpDir, 'conv-json-test', 'session.json');
    const metadataContent = JSON.parse(await readFile(metadataFile, 'utf8'));
    assert.equal(metadataContent.provider, 'antigravity');
    assert.equal(metadataContent.providerSessionId, 'conv-json-test');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity raw capture: unknown or malformed non-JSON lines are preserved as rawText and turn continues', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-raw-malformed-'));
  try {
    const nonJsonLine = '--- MALFORMED OR RAW CLI BANNER [START] ---';
    const stdoutLines = [
      nonJsonLine,
      JSON.stringify({ type: 'init', conversation_id: 'conv-malformed' }),
      'ANOTHER NON-JSON UNRECOGNIZED LINE',
      JSON.stringify({ event: 'result', response: 'Recovered and done' }),
    ];

    const child = createMockProcess(stdoutLines);
    const provider = createAntigravityAgentProvider({
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });

    const turnId = 'turn-malformed-456';
    const result = await provider.startTurn({
      turnId,
      providerSessionId: 'conv-malformed',
      message: 'test non json',
    });
    assert.equal(result.status, 'completed');

    await provider.flushRawCapture('conv-malformed');

    const captureFile = provider.getRawCapturePath('conv-malformed');
    const content = await readFile(captureFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    assert.equal(lines.length, 4);
    assert.equal(lines[0].stream, 'stdout');
    assert.equal(lines[0].turnId, turnId);
    assert.equal(lines[0].rawText, nonJsonLine);
    assert.equal(lines[0].raw, undefined);

    assert.deepEqual(lines[1].raw, { type: 'init', conversation_id: 'conv-malformed' });

    assert.equal(lines[2].stream, 'stdout');
    assert.equal(lines[2].rawText, 'ANOTHER NON-JSON UNRECOGNIZED LINE');

    assert.deepEqual(lines[3].raw, { event: 'result', response: 'Recovered and done' });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity raw capture: stderr is preserved and distinguishable from stdout', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-raw-stderr-'));
  try {
    const events = [
      { stream: 'stdout', line: JSON.stringify({ type: 'init', conversation_id: 'conv-stderr-test' }) },
      { stream: 'stderr', line: 'Debugger listening on ws://127.0.0.1:9229' },
      { stream: 'stderr', line: 'ExperimentalWarning: Custom feature warning' },
      { stream: 'stdout', line: JSON.stringify({ event: 'result', response: 'Finished' }) },
    ];

    const child = createMockProcess([], { events });
    const provider = createAntigravityAgentProvider({
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });

    const result = await provider.startTurn({
      turnId: 'turn-stderr-789',
      providerSessionId: 'conv-stderr-test',
      message: 'trigger stderr',
    });

    assert.equal(result.status, 'completed');

    await provider.flushRawCapture('conv-stderr-test');

    const captureFile = provider.getRawCapturePath('conv-stderr-test');
    const content = await readFile(captureFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    assert.equal(lines.length, 4);
    assert.equal(lines[0].stream, 'stdout');
    assert.equal(lines[0].raw.type, 'init');

    assert.equal(lines[1].stream, 'stderr');
    assert.equal(lines[1].rawText, 'Debugger listening on ws://127.0.0.1:9229');

    assert.equal(lines[2].stream, 'stderr');
    assert.equal(lines[2].rawText, 'ExperimentalWarning: Custom feature warning');

    assert.equal(lines[3].stream, 'stdout');
    assert.equal(lines[3].raw.event, 'result');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity raw capture: diagnostic filesystem write failure is isolated and does not fail the turn', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-raw-fail-'));
  try {
    // Point rawCaptureDir to a regular file so mkdir or write inside it fails
    const blockerFile = join(tmpDir, 'blocker.txt');
    await writeFile(blockerFile, 'blocking directory creation', 'utf8');

    const stdoutLines = [
      JSON.stringify({ type: 'init', conversation_id: 'conv-fail-test' }),
      JSON.stringify({ event: 'result', response: 'Success despite logging failure' }),
    ];

    const child = createMockProcess(stdoutLines);
    const provider = createAntigravityAgentProvider({
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: blockerFile, // using file as directory causes ENOTDIR or EEXIST
    });

    const result = await provider.startTurn({
      turnId: 'turn-fail-test',
      providerSessionId: 'conv-fail-test',
      message: 'test error isolation',
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.providerSessionId, 'conv-fail-test');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity raw capture: strictly preserves chronological ordering across mixed events and streams', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-raw-order-'));
  try {
    const events = [
      { stream: 'stdout', line: JSON.stringify({ type: 'init', conversation_id: 'conv-order-test', seq: 1 }) },
      { stream: 'stdout', line: JSON.stringify({ event: 'step_update', thought: 'Checking environment', seq: 2 }) },
      { stream: 'stderr', line: '[diagnostic warning seq: 3]' },
      { stream: 'stdout', line: JSON.stringify({ event: 'step_update', step_type: 'tool', tool_name: 'bash', state: 'ACTIVE', seq: 4 }) },
      { stream: 'stdout', line: JSON.stringify({ event: 'step_update', step_type: 'tool', tool_name: 'bash', state: 'DONE', seq: 5 }) },
      { stream: 'stdout', line: JSON.stringify({ event: 'step_update', thought: 'Fixing error', seq: 6 }) },
      { stream: 'stderr', line: '[diagnostic warning seq: 7]' },
      { stream: 'stdout', line: JSON.stringify({ event: 'result', response: 'Done', seq: 8 }) },
    ];

    const child = createMockProcess([], { events });
    const provider = createAntigravityAgentProvider({
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });

    const result = await provider.startTurn({
      turnId: 'turn-order-test',
      providerSessionId: 'conv-order-test',
      message: 'test order',
    });

    assert.equal(result.status, 'completed');

    await provider.flushRawCapture('conv-order-test');

    const captureFile = provider.getRawCapturePath('conv-order-test');
    const content = await readFile(captureFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    assert.equal(lines.length, 8);
    assert.equal(lines[0].raw.seq, 1);
    assert.equal(lines[1].raw.seq, 2);
    assert.equal(lines[2].rawText, '[diagnostic warning seq: 3]');
    assert.equal(lines[2].stream, 'stderr');
    assert.equal(lines[3].raw.seq, 4);
    assert.equal(lines[4].raw.seq, 5);
    assert.equal(lines[5].raw.seq, 6);
    assert.equal(lines[6].rawText, '[diagnostic warning seq: 7]');
    assert.equal(lines[6].stream, 'stderr');
    assert.equal(lines[7].raw.seq, 8);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity raw capture: captures trailing events, raw text, and unclosed partial line after result without leaking to semantic stream', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-post-result-'));
  try {
    const child = new EventEmitter();
    child.stdin = new Writable({ write(chunk, enc, cb) { cb(); } });
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.kill = () => { child.killed = true; };

    const provider = createAntigravityAgentProvider({
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });

    const semanticDeltas = [];
    const turnPromise = provider.startTurn({
      turnId: 'turn-post-result',
      providerSessionId: 'conv-post-result',
      message: 'test post result capture',
      emitTextDelta: (delta) => semanticDeltas.push(delta),
    });

    // 1. Initial conversation and tool events
    child.stdout.push(JSON.stringify({ type: 'init', conversation_id: 'conv-post-result' }) + '\n');
    child.stdout.push(JSON.stringify({ event: 'step_update', step_type: 'tool', tool_name: 'read_file', state: 'ACTIVE' }) + '\n');
    child.stdout.push(JSON.stringify({ event: 'step_update', step_type: 'tool', tool_name: 'read_file', state: 'DONE' }) + '\n');

    // 2. Authoritative result event
    child.stdout.push(JSON.stringify({ event: 'result', response: 'Authoritative completion' }) + '\n');

    const result = await turnPromise;
    assert.equal(result.status, 'completed');
    assert.deepEqual(semanticDeltas, ['Authoritative completion']);

    // 3. Trailing events emitted by provider after semantic turn completion
    child.stdout.push(JSON.stringify({ event: 'trailing_event', payload: 'metrics_flush' }) + '\n');
    child.stdout.push('   [raw unformatted trailing diagnostics]   \n');
    // 4. Partial final line without trailing newline
    child.stdout.push('PARTIAL_LINE_WITHOUT_NEWLINE');

    // 5. Child process closes
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit('close', 0);

    // Ensure raw capture queue flushes
    await provider.flushRawCapture('conv-post-result');

    // Verify raw.ndjson content
    const captureFile = provider.getRawCapturePath('conv-post-result');
    const rawContent = await readFile(captureFile, 'utf8');
    const rawLines = rawContent.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    assert.equal(rawLines.length, 7, 'All 7 items must be captured in raw.ndjson');
    assert.equal(rawLines[0].raw.type, 'init');
    assert.equal(rawLines[1].raw.event, 'step_update');
    assert.equal(rawLines[2].raw.event, 'step_update');
    assert.equal(rawLines[3].raw.event, 'result');
    // Trailing JSON event
    assert.equal(rawLines[4].raw.event, 'trailing_event');
    assert.equal(rawLines[4].raw.payload, 'metrics_flush');
    // Trailing non-JSON exact raw text (untrimmed)
    assert.equal(rawLines[5].rawText, '   [raw unformatted trailing diagnostics]   ');
    // Partial line flushed on close
    assert.equal(rawLines[6].rawText, 'PARTIAL_LINE_WITHOUT_NEWLINE');

    // Verify that NO trailing deltas leaked to the semantic stream
    assert.deepEqual(semanticDeltas, ['Authoritative completion']);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity raw capture: disabled by default and normal adapter turn does not touch .nevo-ai-local/antigravity_raw', async () => {
  const { existsSync, readdirSync } = await import('node:fs');
  const realCaptureDir = join(process.cwd(), '.nevo-ai-local', 'antigravity_raw');
  const beforeDirs = existsSync(realCaptureDir) ? new Set(readdirSync(realCaptureDir)) : new Set();

  const child = createMockProcess([
    JSON.stringify({ type: 'init', conversation_id: 'default-no-capture-session' }),
    JSON.stringify({ event: 'result', response: 'Done without capture' }),
  ]);

  // Provider instantiated with default options (rawCaptureEnabled=false)
  const provider = new AntigravityAgentProvider({
    mappingFilePath: null,
    spawnProcess: () => child,
  });

  assert.equal(provider.getRawCapturePath('default-no-capture-session'), null);

  const result = await provider.startTurn({
    turnId: 'turn-no-capture',
    providerSessionId: 'default-no-capture-session',
    message: 'hello',
  });
  assert.equal(result.status, 'completed');

  await provider.flushRawCapture('default-no-capture-session');

  const afterDirs = existsSync(realCaptureDir) ? new Set(readdirSync(realCaptureDir)) : new Set();
  // Ensure no new directories were created
  for (const d of afterDirs) {
    assert.ok(beforeDirs.has(d), `New directory '${d}' must NOT appear in real .nevo-ai-local/antigravity_raw`);
  }
});

test('Antigravity raw capture: rawCaptureSessionDirectory hybrid strategy preserves safe IDs and sanitizes dangerous IDs without collision', () => {
  const tmpBase = join('C:', 'test', 'raw_capture');

  // 1. Safe IDs remain exactly unchanged
  const safeIds = [
    '468ea2f9-9d0f-43e0-960c-feff8cc2bf6a',
    'conv-12345',
    'SESSION_01_alpha-BETA',
    '1234567890',
  ];
  for (const id of safeIds) {
    assert.equal(rawCaptureSessionDirectory(id), id, `Safe ID '${id}' must return unchanged`);
  }

  // 2. Dangerous IDs and Windows reserved device names are sanitized and hash-suffixed
  const dangerousIds = [
    '../outside',
    '../../etc/passwd',
    'foo/bar',
    'foo\\bar',
    'C:\\Windows\\System32',
    '/usr/local/bin',
    '...',
    '..',
    '.',
    'session-with-special!@#$%^&*()_+=~`[]{}|;:\'",.<>?',
    // Windows reserved device names
    'NUL',
    'nul',
    'CON',
    'COM1',
    'LPT9',
  ];

  const encodedSet = new Set();
  for (const id of dangerousIds) {
    const encodedDir = rawCaptureSessionDirectory(id);
    assert.notEqual(encodedDir, id, `Dangerous / reserved ID '${id}' must not return raw unchanged name`);
    assert.doesNotMatch(encodedDir, /[/\\]/, `Encoded directory '${encodedDir}' must not contain slashes`);
    assert.ok(!encodedDir.includes('..'), `Encoded directory '${encodedDir}' must not contain '..'`);
    assert.ok(!encodedDir.includes(':'), `Encoded directory '${encodedDir}' must not contain ':'`);
    assert.match(encodedDir, /^[a-zA-Z0-9_-]+$/, `Encoded directory '${encodedDir}' must use only safe chars`);

    const fullPath = join(tmpBase, encodedDir, 'raw.ndjson');
    assert.ok(fullPath.startsWith(tmpBase), `Resolved full path '${fullPath}' must stay strictly under tmpBase`);

    // Collision resistance check
    assert.ok(!encodedSet.has(encodedDir), `Encoded directory '${encodedDir}' must be unique across distinct IDs`);
    encodedSet.add(encodedDir);
  }

  // Two different unsafe IDs that share prefix must produce distinct directory names
  assert.notEqual(rawCaptureSessionDirectory('foo/bar'), rawCaptureSessionDirectory('foo\\bar'));
  assert.notEqual(rawCaptureSessionDirectory('NUL'), rawCaptureSessionDirectory('CON'));
});

test('Antigravity raw capture: case collision simulation prevents cross-session pollution on case-insensitive filesystems', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-case-collision-'));
  try {
    // 1. Session 1: 'SessionABC' writes first
    const child1 = createMockProcess([
      JSON.stringify({ type: 'init', conversation_id: 'SessionABC' }),
      JSON.stringify({ event: 'result', response: 'Session 1 response' }),
    ]);
    const provider1 = createAntigravityAgentProvider({
      spawnProcess: () => child1,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });
    await provider1.startTurn({
      turnId: 'turn-case-1',
      providerSessionId: 'SessionABC',
      message: 'msg 1',
    });
    await provider1.flushRawCapture('SessionABC');

    const path1 = provider1.getRawCapturePath('SessionABC');
    assert.equal(path1, join(tmpDir, 'SessionABC', 'raw.ndjson'));
    const meta1 = JSON.parse(await readFile(join(tmpDir, 'SessionABC', 'session.json'), 'utf8'));
    assert.equal(meta1.providerSessionId, 'SessionABC');

    // 2. Session 2: 'sessionabc' (case variant) writes next
    const child2 = createMockProcess([
      JSON.stringify({ type: 'init', conversation_id: 'sessionabc' }),
      JSON.stringify({ event: 'result', response: 'Session 2 response' }),
    ]);
    const provider2 = createAntigravityAgentProvider({
      spawnProcess: () => child2,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });
    await provider2.startTurn({
      turnId: 'turn-case-2',
      providerSessionId: 'sessionabc',
      message: 'msg 2',
    });
    await provider2.flushRawCapture('sessionabc');

    const path2 = provider2.getRawCapturePath('sessionabc');
    // On case-insensitive filesystems (Windows), path2 must NOT be tmpDir/SessionABC/raw.ndjson
    assert.notEqual(path2, path1, 'Case variant session must not reuse or overwrite first session capture');

    // Verify content isolation
    const content1 = await readFile(path1, 'utf8');
    const lines1 = content1.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(lines1.length, 2, 'Session 1 capture must contain only its own 2 records');
    assert.equal(lines1[0].providerSessionId, 'SessionABC');

    const content2 = await readFile(path2, 'utf8');
    const lines2 = content2.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(lines2.length, 2, 'Session 2 capture must contain only its own 2 records');
    assert.equal(lines2[0].providerSessionId, 'sessionabc');

    const meta2 = JSON.parse(await readFile(join(dirname(path2), 'session.json'), 'utf8'));
    assert.equal(meta2.providerSessionId, 'sessionabc');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity raw capture: provisional new session migrates to allocated conversation_id, preserves all records and session.json, and logs only final path', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-agy-provisional-'));
  const originalLog = console.log;
  const loggedLines = [];
  console.log = (...args) => {
    loggedLines.push(args.join(' '));
    originalLog(...args);
  };

  try {
    const stdoutLines = [
      JSON.stringify({ type: 'init', conversation_id: 'allocated-agy-9876' }),
      JSON.stringify({ event: 'step_update', thought: 'Planning task' }),
      JSON.stringify({ event: 'result', response: 'New session task finished' }),
    ];

    const child = createMockProcess(stdoutLines);
    const provider = createAntigravityAgentProvider({
      spawnProcess: () => child,
      rawCaptureEnabled: true,
      rawCaptureDir: tmpDir,
    });

    // Start turn with NO providerSessionId (provisional session)
    const result = await provider.startTurn({
      turnId: 'turn-provisional-1',
      providerSessionId: null,
      message: 'start new conversation',
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.providerSessionId, 'allocated-agy-9876');

    await provider.flushRawCapture('allocated-agy-9876');

    // 1. Verify logging: only the allocated session capture path was logged, not the provisional UUID
    const rawCaptureLogs = loggedLines.filter(l => l.includes('Antigravity raw capture:'));
    assert.equal(rawCaptureLogs.length, 1, 'Exactly one raw capture log must be emitted');
    assert.ok(rawCaptureLogs[0].includes('allocated-agy-9876'), 'Logged path must be the final allocated session');

    // 2. Verify files: final allocated directory exists and contains all lines
    const finalDir = join(tmpDir, 'allocated-agy-9876');
    const captureFile = join(finalDir, 'raw.ndjson');
    const content = await readFile(captureFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    assert.equal(lines.length, 3, 'All 3 lines (including init) must be migrated to the allocated session file');
    // Ensure every record has the canonical allocated providerSessionId in the envelope
    for (let i = 0; i < lines.length; i++) {
      assert.equal(
        lines[i].providerSessionId,
        'allocated-agy-9876',
        `Record ${i} must have canonical providerSessionId after migration`
      );
    }
    // Ensure the raw provider payload was NOT altered or corrupted
    assert.deepEqual(lines[0].raw, { type: 'init', conversation_id: 'allocated-agy-9876' });
    assert.equal(lines[1].raw.event, 'step_update');
    assert.equal(lines[2].raw.event, 'result');

    // 3. Verify session.json metadata in final directory
    const metadataFile = join(finalDir, 'session.json');
    const metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
    assert.equal(metadata.provider, 'antigravity');
    assert.equal(metadata.providerSessionId, 'allocated-agy-9876');
  } finally {
    console.log = originalLog;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Antigravity error result: event "result" + status "ERROR" + empty response fails turn with error message and emits no empty prose', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-err-empty' }),
    JSON.stringify({
      event: 'result',
      result: {
        status: 'ERROR',
        response: '',
        error: 'ContentOffset 22500 exceeds line range size 1792',
      },
    }),
  ];

  const textDeltas = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  await assert.rejects(
    async () => {
      await provider.startTurn({
        turnId: 'turn-err-empty',
        providerSessionId: 'conv-err-empty',
        message: 'View file',
        emitTextDelta: (t) => textDeltas.push(t),
      });
    },
    (err) => {
      assert.equal(err.code, 'AI_PROVIDER_ERROR');
      assert.equal(err.message, 'ContentOffset 22500 exceeds line range size 1792');
      return true;
    }
  );

  assert.equal(textDeltas.length, 0, 'must not emit any text delta for empty response on error');
});

test('Antigravity error result: event "result" + status "ERROR" with non-empty response completes turn successfully with response text and avoids false-positive error', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-err-response' }),
    JSON.stringify({
      event: 'result',
      result: {
        status: 'ERROR',
        response: 'Odpowiedź asystenta wygenerowana mimo wcześniejszego błędu w sesji',
        error: 'Earlier tool failed',
      },
    }),
  ];

  const textDeltas = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const result = await provider.startTurn({
    turnId: 'turn-err-response',
    providerSessionId: 'conv-err-response',
    message: 'Do work',
    emitTextDelta: (t) => textDeltas.push(t),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(textDeltas, ['Odpowiedź asystenta wygenerowana mimo wcześniejszego błędu w sesji'], 'must preserve and emit response text without failing turn');
});

test('Antigravity error result: event "result" + status "ERROR" preserves usage metrics before failing', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-err-usage' }),
    JSON.stringify({
      event: 'result',
      result: {
        status: 'ERROR',
        response: '',
        error: 'Rate limit hit',
        usage: {
          input_tokens: 350,
          output_tokens: 42,
          cost: 0.005,
        },
      },
    }),
  ];

  const usages = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  await assert.rejects(
    async () => {
      await provider.startTurn({
        turnId: 'turn-err-usage',
        providerSessionId: 'conv-err-usage',
        message: 'Do work',
        emitUsageUpdated: (u) => usages.push(u),
      });
    },
    (err) => {
      assert.equal(err.code, 'AI_PROVIDER_ERROR');
      assert.equal(err.message, 'Rate limit hit');
      return true;
    }
  );

  assert.equal(usages.length, 1);
  assert.equal(usages[0].tokensIn, 350);
  assert.equal(usages[0].tokensOut, 42);
  assert.equal(usages[0].cost, 0.005);
});

test('Antigravity successful result: event "result" + status "SUCCESS" completes turn normally', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-success-status' }),
    JSON.stringify({
      event: 'result',
      result: {
        status: 'SUCCESS',
        response: 'Wszystko wykonane pomyślnie.',
        usage: {
          tokensIn: 100,
          tokensOut: 50,
        },
      },
    }),
  ];

  const textDeltas = [];
  const usages = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const result = await provider.startTurn({
    turnId: 'turn-success-status',
    providerSessionId: 'conv-success-status',
    message: 'Do task',
    emitTextDelta: (t) => textDeltas.push(t),
    emitUsageUpdated: (u) => usages.push(u),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(textDeltas, ['Wszystko wykonane pomyślnie.']);
  assert.equal(usages.length, 1);
  assert.equal(usages[0].tokensIn, 100);
  assert.equal(usages[0].tokensOut, 50);
});

test('Antigravity deduplicates already streamed text even when result event carries status ERROR', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-err-streamed' }),
    JSON.stringify({ event: 'step_update', step_update: { text_delta: 'Wystreamowany tekst' } }),
    JSON.stringify({
      event: 'result',
      result: {
        status: 'ERROR',
        response: 'Wystreamowany tekst',
        error: 'Błąd po wygenerowaniu tekstu',
      },
    }),
  ];

  const textDeltas = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  const result = await provider.startTurn({
    turnId: 'turn-err-streamed',
    providerSessionId: 'conv-err-streamed',
    message: 'Stream and complete',
    emitTextDelta: (t) => textDeltas.push(t),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(textDeltas, ['Wystreamowany tekst'], 'must not duplicate text that was already streamed');
});

test('Antigravity error result: still-active tool call is resolved to failed', async () => {
  const lines = [
    JSON.stringify({ type: 'init', conversation_id: 'conv-err-tool' }),
    JSON.stringify({ type: 'tool.started', toolId: 't-unfin', toolName: 'Bash', input: { command: 'npm test' } }),
    JSON.stringify({
      event: 'result',
      result: {
        status: 'ERROR',
        response: '',
        error: 'Execution failed',
      },
    }),
  ];

  const toolsCompleted = [];
  const provider = createAntigravityAgentProvider({
    spawnProcess: () => createMockProcess(lines),
  });

  await assert.rejects(
    async () => {
      await provider.startTurn({
        turnId: 'turn-err-tool',
        providerSessionId: 'conv-err-tool',
        message: 'Run tool and fail',
        emitToolCompleted: (t) => toolsCompleted.push(t),
      });
    },
    (err) => {
      assert.equal(err.code, 'AI_PROVIDER_ERROR');
      assert.equal(err.message, 'Execution failed');
      return true;
    }
  );

  assert.equal(toolsCompleted.length, 1);
  assert.equal(toolsCompleted[0].toolId, 't-unfin');
  assert.equal(toolsCompleted[0].status, 'failed');
});


