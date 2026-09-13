import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TurnLifecycleCoordinator } from '../server/ai/sessions/turns/coordinator.mjs';
import { SessionTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';

// PR #47 final regression: a cancelled/failed/interrupted turn must never silently discard
// previously-emitted, user-visible finalAnswer text (status -> 'absent'), and must never
// fabricate a successful completion for it either (status -> 'completed'). Emitted-but-not-
// authoritatively-finished text settles as 'interrupted' — distinct from both.

test('scenario A: emitted final-answer text survives cancellation as interrupted, never absent or completed', () => {
  const coordinator = new TurnLifecycleCoordinator({ turnId: 'turn-a', sessionId: 'sess-a', provider: 'claude' });

  coordinator.recordFinalAnswerDelta('Here is the summary of what changed.');
  assert.equal(coordinator.turn.finalAnswer.status, 'streaming');

  coordinator.requestCancellation({ initiator: 'user' });
  const settled = coordinator.settleTerminal({ outcome: 'failed', initiator: 'provider' });

  assert.equal(settled.outcome, 'cancelled');
  assert.equal(coordinator.turn.finalAnswer.status, 'interrupted');
  assert.equal(coordinator.turn.finalAnswer.text, 'Here is the summary of what changed.');
  assert.equal(coordinator.turn.finalAnswer.completedAt, undefined);
});

test('scenario B: an interrupted final answer survives a reload through a fresh transcript-cache instance', async () => {
  const capabilities = Object.freeze({
    interactivePermissions: false,
    interactiveQuestions: false,
    interactiveConfirmations: false,
    resumeSession: true,
    cancelTurn: true,
    toolCalls: false,
    reasoning: false,
    usage: false,
    steerTurn: false,
    planUpdates: false,
  });

  let releaseHang;
  const provider = {
    descriptor: { id: 'fake-reload', label: 'Fake', capabilities },
    async startTurn({ providerSessionId, setProviderSessionId, emitFinalAnswerDelta, signal }) {
      if (!providerSessionId && setProviderSessionId) setProviderSessionId('sess-reload-1');
      emitFinalAnswerDelta?.('Zacommitowane i wypchniete.');
      await new Promise((resolve, reject) => {
        releaseHang = resolve;
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
    async cancelTurn() {},
  };

  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-final-answer-reload-'));
  try {
    const transcriptCache = new SessionTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry([provider]);
    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
      idFactory: (() => {
        let id = 0;
        return () => String(++id);
      })(),
      idleTimeoutMs: 0,
    });

    const { turnId } = await runtime.startTurn({
      provider: 'fake-reload',
      providerSessionId: 'sess-reload-1',
      message: 'hi',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await runtime.cancelTurn(turnId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await transcriptCache.flush?.('fake-reload', 'sess-reload-1');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Simulate a browser refresh hitting a freshly-booted server: a brand new cache
    // instance over the same directory, with nothing in memory, must read this off disk.
    const reloadedCache = new SessionTranscriptCacheService({ baseDir: tmpDir });
    const reloaded = await reloadedCache.getTranscript('fake-reload', 'sess-reload-1');
    const turn = reloaded.turns.find((t) => t.id === turnId);

    assert.ok(turn, 'turn must be persisted');
    assert.equal(turn.status.status, 'terminal');
    assert.equal(turn.status.outcome, 'cancelled');
    assert.equal(turn.finalAnswer.status, 'interrupted');
    assert.equal(turn.finalAnswer.text, 'Zacommitowane i wypchniete.');

    runtime.shutdown?.();
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 25));
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('scenario C: a turn that fails after producing text preserves the text as interrupted, associated with the failed outcome', () => {
  const coordinator = new TurnLifecycleCoordinator({ turnId: 'turn-c', sessionId: 'sess-c', provider: 'codex' });

  coordinator.recordFinalAnswerDelta('Partial analysis before the crash.');
  const settled = coordinator.settleTerminal({
    outcome: 'failed',
    initiator: 'provider',
    error: { code: 'AI_TURN_FAILED', message: 'Provider process crashed.' },
  });

  assert.equal(settled.outcome, 'failed');
  assert.equal(coordinator.turn.finalAnswer.status, 'interrupted');
  assert.equal(coordinator.turn.finalAnswer.text, 'Partial analysis before the crash.');
  assert.equal(coordinator.turn.terminalOutcome.outcome, 'failed');
  assert.equal(coordinator.turn.terminalOutcome.error.code, 'AI_TURN_FAILED');
});

test('scenario D: a live coordinator recovering a lost operation preserves emitted text as interrupted, not completed', () => {
  const coordinator = new TurnLifecycleCoordinator({ turnId: 'turn-d', sessionId: 'sess-d', provider: 'codex' });

  coordinator.recordFinalAnswerDelta('Draft answer before the connection was lost.');
  coordinator.markOperationLost({ reason: 'operation_lost', code: 'AI_OPERATION_LOST' });
  assert.equal(coordinator.status.status, 'unknown');

  // Confirmed process death without authoritative provider evidence: liveness cessation
  // only, never a fabricated 'completed'/'failed' — settles as 'interrupted'.
  const settled = coordinator.reconcileProcessTermination({ cause: 'process_terminated' });

  assert.equal(settled.outcome, 'interrupted');
  assert.equal(coordinator.turn.finalAnswer.status, 'interrupted');
  assert.equal(coordinator.turn.finalAnswer.text, 'Draft answer before the connection was lost.');
});

test('scenario D2: boot-time reconciliation of an orphaned turn preserves emitted text as interrupted (transcript-cache path)', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-final-answer-orphan-'));
  try {
    const transcriptCache = new SessionTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const coordinator = new TurnLifecycleCoordinator({ turnId: 'turn-d2', sessionId: 'sess-d2', provider: 'antigravity' });
    coordinator.recordFinalAnswerDelta('Streaming answer, then the server restarted mid-turn.');
    transcriptCache.recordCanonicalTurn('antigravity', 'sess-d2', coordinator.turn);
    // recordCanonicalTurn only tracks activeTurn while status isn't terminal; the coordinator
    // itself never settled (simulating an ungraceful restart mid-turn).

    transcriptCache.markTurnInterrupted('antigravity', 'sess-d2', {
      text: 'Interrupted by server restart.',
      cause: 'server-restart',
      outcome: 'interrupted',
    });

    const transcript = await transcriptCache.getTranscript('antigravity', 'sess-d2');
    const turn = transcript.turns.find((t) => t.id === 'turn-d2');
    assert.equal(turn.status.status, 'terminal');
    assert.equal(turn.status.outcome, 'interrupted');
    assert.equal(turn.finalAnswer.status, 'interrupted');
    assert.equal(turn.finalAnswer.text, 'Streaming answer, then the server restarted mid-turn.');
  } finally {
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('scenario E: a turn that terminates before emitting any final-answer content remains genuinely absent', () => {
  const withoutFinalAnswer = new TurnLifecycleCoordinator({ turnId: 'turn-e1', sessionId: 'sess-e1', provider: 'claude' });
  withoutFinalAnswer.settleTerminal({ outcome: 'failed', initiator: 'provider' });
  assert.equal(withoutFinalAnswer.turn.finalAnswer, null);

  // A finalAnswer object that exists but never received any emitted text still seals to 'absent'.
  const withEmptyFinalAnswer = new TurnLifecycleCoordinator({ turnId: 'turn-e2', sessionId: 'sess-e2', provider: 'claude' });
  withEmptyFinalAnswer.setFinalAnswer({ id: 'final-answer', text: '', status: 'streaming' });
  withEmptyFinalAnswer.settleTerminal({ outcome: 'failed', initiator: 'provider' });
  assert.equal(withEmptyFinalAnswer.turn.finalAnswer.status, 'absent');
});

test('scenario F: a normal completed turn seals finalAnswer to completed exactly as before', () => {
  const coordinator = new TurnLifecycleCoordinator({ turnId: 'turn-f', sessionId: 'sess-f', provider: 'claude' });
  coordinator.recordFinalAnswerDelta('All tests passed.');
  const settled = coordinator.settleTerminal({ outcome: 'completed', initiator: 'provider' });

  assert.equal(settled.outcome, 'completed');
  assert.equal(coordinator.turn.finalAnswer.status, 'completed');
  assert.equal(coordinator.turn.finalAnswer.text, 'All tests passed.');
  assert.ok(coordinator.turn.finalAnswer.completedAt);
});

test('scenario G: Claude multi-round background-task pattern — no false completed turn between rounds, later cancellation preserves first-round text truthfully', () => {
  const coordinator = new TurnLifecycleCoordinator({ turnId: 'turn-g', sessionId: 'sess-g', provider: 'claude' });

  // Round 1: the CLI emits a `result`/`stop_reason: end_turn` frame; the adapter projects
  // its text as a finalAnswerDelta, but this must not by itself settle the turn.
  coordinator.recordFinalAnswerDelta('I finished the requested change and pushed it.');
  assert.equal(coordinator.turn.finalAnswer.status, 'streaming');
  assert.equal(coordinator.isTerminal, false);

  // Background task continuation: the CLI process stays alive and a further round runs
  // (e.g. a subagent reporting back). The turn must remain open across it.
  coordinator.recordToolStarted({ toolId: 'bg-1', toolName: 'Bash' });
  coordinator.recordToolCompleted({ toolId: 'bg-1', output: 'done', status: 'completed' });
  assert.equal(coordinator.isTerminal, false, 'turn must remain open across multiple provider rounds');
  assert.equal(coordinator.turn.finalAnswer.status, 'streaming', 'no false completion between rounds');

  // The user cancels before the underlying CLI process itself closes.
  coordinator.requestCancellation({ initiator: 'user' });
  const settled = coordinator.settleTerminal({ outcome: 'failed', initiator: 'provider' });

  assert.equal(settled.outcome, 'cancelled');
  assert.equal(coordinator.turn.finalAnswer.status, 'interrupted');
  assert.equal(coordinator.turn.finalAnswer.text, 'I finished the requested change and pushed it.');
});
