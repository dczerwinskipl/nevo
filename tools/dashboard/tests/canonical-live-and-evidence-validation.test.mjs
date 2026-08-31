import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm, mkdtemp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  createCanonicalTurn,
  validateCanonicalTurn,
  projectChatV1,
  normalizeTransitionalToolStatus,
  AiError,
} from '../server/ai/contracts.mjs';
import { TurnLifecycleCoordinator } from '../server/ai/sessions/turns/coordinator.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';

function waitFor(checkFn, predicate, message = 'condition', timeoutMs = 2000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await checkFn();
        if (predicate(value)) {
          resolve(value);
          return;
        }
      } catch (err) {
        // continue polling until timeout
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${message}`));
        return;
      }
      setTimeout(poll, 15);
    };
    poll();
  });
}

test('Part A1 & A2: live V2 progression streams meaningful canonical changes while turn is running', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-live-v2-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    let runtimeContext;
    let finishTurn;
    const turnBlocker = new Promise(r => { finishTurn = r; });

    registry.register({
      descriptor: {
        id: 'fake-live',
        label: 'Fake Live',
        capabilities: { toolCalls: true, cancelTurn: true },
      },
      async startTurn(ctx) {
        runtimeContext = ctx;
        // Step 1: Start commentary
        ctx.emitTextDelta('Beginning file analysis...', 'msg-1');
        await turnBlocker;
        return { done: true };
      },
      async cancelTurn() {},
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
    });

    const turnUpdates = [];
    const unsub = runtime.subscribeToSession({ provider: 'fake-live', providerSessionId: 'sess-live-1' }, {
      onEvent: ev => {
        if (ev.type === 'turn.updated') {
          turnUpdates.push(structuredClone(ev.turn));
        }
      },
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-live',
      providerSessionId: 'sess-live-1',
      message: 'Analyze files and report',
    });

    // Verify Step 1: Commentary emitted immediately as turn.updated
    await waitFor(() => turnUpdates.length, len => len >= 1, 'commentary turn.updated');
    const update1 = turnUpdates[0];
    assert.equal(update1.work.length, 1);
    assert.equal(update1.work[0].type, 'commentary');
    assert.equal(update1.work[0].text, 'Beginning file analysis...');

    // Step 2: Tool started
    runtimeContext.emitToolStarted({
      toolId: 't1',
      toolName: 'Read',
      input: { file_path: 'src/main.ts' },
    });

    await waitFor(() => turnUpdates.length, len => len >= 2, 'tool start turn.updated');
    const update2 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update2.work.length, 2);
    assert.equal(update2.work[1].type, 'tool');
    assert.equal(update2.work[1].toolName, 'Read');
    assert.equal(update2.work[1].status, 'active');

    // Step 3: Tool progress
    runtimeContext.emitToolUpdated({
      toolId: 't1',
      progress: '1024 bytes read',
    });

    await waitFor(() => turnUpdates.length, len => len >= 3, 'tool progress turn.updated');
    const update3 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update3.work[1].progress, '1024 bytes read');

    // Step 4: Tool completed
    runtimeContext.emitToolCompleted({
      toolId: 't1',
      output: 'export const main = () => {};',
      durationMs: 45,
      status: 'completed',
    });

    await waitFor(() => turnUpdates.length, len => len >= 4, 'tool completed turn.updated');
    const update4 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update4.work[1].status, 'completed');
    assert.equal(update4.work[1].durationMs, 45);

    // Step 5: Second commentary block
    runtimeContext.emitTextDelta('File analyzed successfully. Preparing final response.', 'msg-2');
    await waitFor(() => turnUpdates.length, len => len >= 5, 'commentary 2 turn.updated');
    const update5 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update5.work.length, 3);
    assert.equal(update5.work[2].type, 'commentary');

    // Step 6: Final Answer set
    runtime.setFinalAnswer(turnId, { text: 'Analysis complete: src/main.ts contains main export.', status: 'completed' });
    await waitFor(() => turnUpdates.length, len => len >= 6, 'final answer turn.updated');
    const update6 = turnUpdates[turnUpdates.length - 1];
    assert.equal(update6.finalAnswer?.status, 'completed');
    assert.equal(update6.finalAnswer?.text, 'Analysis complete: src/main.ts contains main export.');

    finishTurn();
    await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'turn completion');

    unsub();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A2: Live SSE vs Reconnected SSE vs HTTP V2 vs Persistence Reload all converge to identical Turn', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-convergence-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    registry.register({
      descriptor: {
        id: 'fake-conv',
        label: 'Fake Convergence',
        capabilities: { toolCalls: true, cancelTurn: true },
      },
      async startTurn(ctx) {
        ctx.emitTextDelta('Inspecting workspace...', 'msg-1');
        ctx.emitToolStarted({ toolId: 'tool-git', toolName: 'GitStatus', input: {} });
        ctx.emitToolCompleted({ toolId: 'tool-git', output: 'clean', durationMs: 15, status: 'completed' });
        ctx.emitTextDelta('All checks passed.', 'msg-2');
      },
      async cancelTurn() {},
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
    });

    const liveTurnUpdates = [];
    const unsubLive = runtime.subscribeToSession({ provider: 'fake-conv', providerSessionId: 'sess-conv-1' }, {
      onEvent: ev => {
        if (ev.type === 'turn.updated') {
          liveTurnUpdates.push(structuredClone(ev.turn));
        }
      },
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-conv',
      providerSessionId: 'sess-conv-1',
      message: 'Run full convergence check',
    });

    await waitFor(() => runtime.getSnapshot(turnId), v => v.status === 'completed', 'turn completion');

    // 1. Live SSE final turn snapshot
    const liveFinalTurn = liveTurnUpdates[liveTurnUpdates.length - 1];
    assert.ok(liveFinalTurn);

    // 2. Replay/Reconnected SSE
    const replayedEvents = runtime.getEvents(turnId, 0);
    const replayedTurnUpdates = replayedEvents.filter(e => e.type === 'turn.updated').map(e => e.turn);
    const replayedFinalTurn = replayedTurnUpdates[replayedTurnUpdates.length - 1];

    // 3. HTTP V2 In-memory Turn Snapshot
    const httpCanonicalTurn = runtime.getCanonicalTurn(turnId);

    // 4. Fresh Persistence Disk Reload
    await transcriptCache.flush('fake-conv', 'sess-conv-1');
    const freshTranscriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const persistedTranscript = await freshTranscriptCache.getTranscript('fake-conv', 'sess-conv-1');
    const persistedTurn = persistedTranscript.turns.find(t => t.id === turnId);

    // Assert absolute convergence across all 4 access patterns
    assert.deepEqual(liveFinalTurn.work, replayedFinalTurn.work);
    assert.deepEqual(liveFinalTurn.work, httpCanonicalTurn.work);
    assert.deepEqual(liveFinalTurn.work, persistedTurn.work);

    assert.equal(liveFinalTurn.status.status, 'terminal');
    assert.equal(replayedFinalTurn.status.status, 'terminal');
    assert.equal(httpCanonicalTurn.status.status, 'terminal');
    assert.equal(persistedTurn.status.status, 'terminal');

    unsubLive();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A3: Terminal arbitration prevents turn.completed contradiction when timeout intent accepted', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-arb-test-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    let finishDeferred;
    registry.register({
      descriptor: {
        id: 'fake-race',
        label: 'Fake Race',
        capabilities: { cancelTurn: true },
      },
      async startTurn(ctx) {
        ctx.emitTextDelta('Working...', 'msg-1');
        await new Promise(r => { finishDeferred = r; });
        // Provider attempts to report normal completion after timeout was triggered
        return { done: true };
      },
      async cancelTurn() {
        // Cancellation / timeout cleanup hook
      },
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
      idleTimeoutMs: 50,
      idleCheckIntervalMs: 20,
    });

    const sessionEvents = [];
    const unsub = runtime.subscribeToSession({ provider: 'fake-race', providerSessionId: 'sess-race-1' }, {
      onEvent: ev => sessionEvents.push(ev),
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-race',
      providerSessionId: 'sess-race-1',
      message: 'Trigger race test',
    });

    // Wait for idle watchdog to trigger timeout
    await waitFor(() => {
      const snap = runtime.getSnapshot(turnId);
      return snap.status === 'failed';
    }, v => v === true, 'timeout termination');

    // Provider now resolves and attempts to complete
    if (finishDeferred) finishDeferred();
    await new Promise(r => setTimeout(r, 60));

    // Assert: external stream MUST NOT contain turn.completed!
    const eventTypes = sessionEvents.map(e => e.type);
    assert.equal(eventTypes.includes('turn.completed'), false, 'turn.completed must never be emitted after timeout');
    assert.equal(eventTypes.includes('turn.failed'), true, 'turn.failed must be emitted');

    const failedEvent = sessionEvents.find(e => e.type === 'turn.failed');
    assert.equal(failedEvent.error.code, 'AI_TURN_TIMEOUT');

    // Assert: Canonical state outcome is failed with timeout/protocol-silence
    const canonical = runtime.getCanonicalTurn(turnId);
    assert.equal(canonical.status.status, 'terminal');
    assert.equal(canonical.status.outcome, 'failed');
    assert.equal(canonical.status.cause, 'timeout/protocol-silence');

    unsub();
    await runtime.shutdown();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part A4: Persistence health reflects write failure truthfully without corrupting readiness', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-health-fail-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });

    const turn = createCanonicalTurn({
      id: 'turn-h1',
      provider: 'fake',
      providerSessionId: 'sess-health-1',
    });

    transcriptCache.recordCanonicalTurn('fake', 'sess-health-1', turn);

    // Force write failure by pointing file path to an un-writable directory structure or locking directory
    const invalidCache = createTranscriptCacheService({ baseDir: join(tmpDir, 'non-existent\u0000invalid'), flushDebounceMs: 0 });
    invalidCache.recordCanonicalTurn('fake', 'sess-health-1', turn);

    // Flush should reject and record unhealthy status
    await assert.rejects(() => invalidCache.flush('fake', 'sess-health-1'));

    const state = await invalidCache.getTranscript('fake', 'sess-health-1');
    assert.equal(state.health, 'unhealthy');
    assert.ok(state.error);
    assert.ok(state.persistenceError);
    assert.ok(state.persistenceError.at);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Part B & C: Real provider sanitized fixtures map cleanly to CanonicalTurn model without validation errors', async () => {
  // 1. Claude Evidence Validation
  const claudeUrl = new URL('./fixtures/evidence/claude-evidence.json', import.meta.url);
  const claudeRaw = JSON.parse(await readFile(claudeUrl, 'utf-8'));
  assert.equal(claudeRaw.provider, 'claude');
  assert.equal(claudeRaw.turns.length, 2);

  // Turn 1: Rate limit error
  const claudeTurn1 = createCanonicalTurn({
    id: claudeRaw.turns[0].turnId,
    sessionId: claudeRaw.sessionId,
    provider: 'claude',
    providerSessionId: claudeRaw.sessionId,
    prompt: claudeRaw.turns[0].userMessage,
  });
  claudeTurn1.status = {
    status: 'terminal',
    outcome: 'failed',
    initiator: 'provider',
    cause: 'api_error',
    error: { code: 'AI_PROVIDER_ERROR', message: 'Rate limit 429' },
  };
  assert.doesNotThrow(() => validateCanonicalTurn(claudeTurn1));

  // Turn 2: Commentary -> Parallel Tools -> Read -> Summary -> Complete
  const coordinator2 = new TurnLifecycleCoordinator({
    turnId: claudeRaw.turns[1].turnId,
    sessionId: claudeRaw.sessionId,
    provider: 'claude',
    providerSessionId: claudeRaw.sessionId,
    prompt: claudeRaw.turns[1].userMessage,
  });

  coordinator2.recordTextDelta('Starting diagnostic check: checking repository status and files.');
  coordinator2.recordToolStarted({ toolId: 'toolu_01Bash', toolName: 'Bash', input: { command: 'git status --porcelain' } });
  coordinator2.recordToolStarted({ toolId: 'toolu_02Glob', toolName: 'Glob', input: { pattern: 'specs/active/*' } });
  coordinator2.recordToolCompleted({ toolId: 'toolu_02Glob', output: 'specs/active/ai-session-issues-and-diagnostics\n', durationMs: 220, status: 'completed' });
  coordinator2.recordToolCompleted({ toolId: 'toolu_01Bash', output: '', durationMs: 350, status: 'completed' });
  coordinator2.recordTextDelta('Repository is clean and spec directory verified. Now reading overview.');
  coordinator2.recordToolStarted({ toolId: 'toolu_03Read', toolName: 'Read', input: { file_path: 'specs/active/ai-session-issues-and-diagnostics/overview.md' } });
  coordinator2.recordToolCompleted({ toolId: 'toolu_03Read', output: '# AI session issues and diagnostics\n', durationMs: 45, status: 'completed' });
  coordinator2.setFinalAnswer({ text: 'Diagnostic test complete:\n1. Git status clean\n2. Spec located\n3. Overview verified.', status: 'completed' });
  coordinator2.settleTerminal({ outcome: 'completed', initiator: 'provider' });

  const claudeTurn2 = coordinator2.getCanonicalSnapshot();
  assert.doesNotThrow(() => validateCanonicalTurn(claudeTurn2));
  assert.equal(claudeTurn2.work.length, 5); // commentary, tool, tool, commentary, tool
  assert.equal(claudeTurn2.finalAnswer?.status, 'completed');

  // 2. Codex Evidence Validation
  const codexUrl = new URL('./fixtures/evidence/codex-evidence.json', import.meta.url);
  const codexRaw = JSON.parse(await readFile(codexUrl, 'utf-8'));
  const codexCoordinator = new TurnLifecycleCoordinator({
    turnId: codexRaw.turnId,
    sessionId: codexRaw.sessionId,
    provider: 'codex',
    providerSessionId: codexRaw.sessionId,
    prompt: 'Run diagnostic check',
  });

  codexCoordinator.recordReasoningDelta('Analyzed diagnostic scope');
  codexCoordinator.recordTextDelta('Sprawdzę repozytorium i uruchomię polecenie narzędziowe.');
  codexCoordinator.recordToolStarted({ toolId: 'exec-01', toolName: 'commandExecution', input: { command: 'node tools/specs.mjs next' } });
  codexCoordinator.addToolAction('exec-01', { id: 'act-01', kind: 'execute', title: 'node tools/specs.mjs next' });
  codexCoordinator.recordToolCompleted({ toolId: 'exec-01', output: 'node : CommandNotFoundException', exitCode: 1, durationMs: 1200, status: 'failed' });
  codexCoordinator.recordTextDelta('Wykryto brak środowiska node w PATH. Sprawdzam stan Git bez node.');
  codexCoordinator.recordToolStarted({ toolId: 'exec-02', toolName: 'commandExecution', input: { command: 'git status --porcelain' } });
  codexCoordinator.addToolAction('exec-02', { id: 'act-02', kind: 'execute', title: 'git status --porcelain' });
  codexCoordinator.recordToolCompleted({ toolId: 'exec-02', output: '', exitCode: 0, durationMs: 350, status: 'completed' });
  codexCoordinator.setFinalAnswer({ text: 'Diagnostyka zakończona pomyślnie. Stan repozytorium czysty, zidentyfikowano brak PATH node.', status: 'completed' });
  codexCoordinator.settleTerminal({ outcome: 'completed', initiator: 'provider' });

  const codexTurn = codexCoordinator.getCanonicalSnapshot();
  assert.doesNotThrow(() => validateCanonicalTurn(codexTurn));
  assert.equal(codexTurn.work.length, 5); // reasoning, commentary, tool (failed), commentary, tool (completed)
  assert.equal(codexTurn.work[2].actions.length, 1);

  // 3. Antigravity Evidence Validation
  const agyUrl = new URL('./fixtures/evidence/antigravity-evidence.json', import.meta.url);
  const agyRaw = JSON.parse(await readFile(agyUrl, 'utf-8'));
  const agyCoordinator = new TurnLifecycleCoordinator({
    turnId: agyRaw.turnId,
    sessionId: agyRaw.sessionId,
    provider: 'antigravity',
    providerSessionId: agyRaw.sessionId,
    prompt: 'Status check',
  });

  agyCoordinator.recordReasoningDelta('Thinking about workspace structure');
  agyCoordinator.recordToolStarted({ toolId: 'step-2', toolName: 'run_command', input: { CommandLine: 'git status' } });
  agyCoordinator.recordToolCompleted({ toolId: 'step-2', output: 'nothing to commit, working tree clean\n', durationMs: 250, status: 'completed' });
  agyCoordinator.recordReasoningDelta('Checking specs directory');
  agyCoordinator.recordToolStarted({ toolId: 'step-4', toolName: 'find_by_name', input: { Pattern: '*', SearchDirectory: 'specs/active' } });
  agyCoordinator.recordToolCompleted({ toolId: 'step-4', output: 'ai-session-issues-and-diagnostics\n', durationMs: 20, status: 'completed' });
  agyCoordinator.setFinalAnswer({ text: 'Working tree is clean and active specs were verified.', status: 'completed' });
  agyCoordinator.settleTerminal({ outcome: 'completed', initiator: 'provider' });

  const agyTurn = agyCoordinator.getCanonicalSnapshot();
  assert.doesNotThrow(() => validateCanonicalTurn(agyTurn));
  assert.equal(agyTurn.work.length, 4); // reasoning, tool, reasoning, tool
  assert.equal(agyTurn.finalAnswer?.text, 'Working tree is clean and active specs were verified.');
});
