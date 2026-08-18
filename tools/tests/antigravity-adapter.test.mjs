import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AntigravityAgentProvider,
  ANTIGRAVITY_CAPABILITIES,
} from '../ai/antigravity-adapter.mjs';
import { createAiAdapterRegistry } from '../ai/registry.mjs';
import { CapabilityNotSupportedError } from '../ai/contracts.mjs';

function createAntigravityAgentProvider(options = {}) {
  return new AntigravityAgentProvider({
    mappingFilePath: null,
    ...options,
  });
}

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

test('cancelTurn escalates to a forceful, unsignaled kill when SIGINT is ignored past the grace period', async () => {
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
  assert.deepEqual(child.killCalls, ['SIGINT', undefined]);

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

test('Antigravity ask mode behavioral guarantee: offline provider evidence reflects that mutation is blocked in plan mode', async () => {
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
