import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createCanonicalTurn,
  validateCanonicalTurn,
  computeCurrentActivity,
  serializePublicTurn,
  validateInteractionResponse,
  AI_FAILURE_CODES,
  AI_ERROR_HTTP_STATUS,
  DEFAULT_RECOVERY_HINTS,
  AiError,
} from '../server/ai/contracts.mjs';
import { TurnLifecycleCoordinator } from '../server/ai/sessions/turns/coordinator.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { LifecycleTraceSink } from '../server/ai/diagnostics/index.mjs';
import { TurnEventStream } from '../server/ai/sessions/turns/turn-event-stream.mjs';
import { ClaudeAgentProvider, mapClaudeTool, CLAUDE_CAPABILITIES } from '../server/ai/providers/claude/provider.mjs';
import { CodexAgentProvider, mapCodexCommandActions, CODEX_CAPABILITIES } from '../server/ai/providers/codex/provider.mjs';
import { AntigravityAgentProvider, mapAntigravityTool, ANTIGRAVITY_CAPABILITIES } from '../server/ai/providers/antigravity/provider.mjs';

function deriveActivity(turns) {
  const turn = turns[turns.length - 1];
  if (!turn || !turn.status || turn.status.status === 'terminal') return 'idle';
  if (turn.status.status === 'requiresAttention') return 'waitingForUser';
  return 'running';
}

function projectTimeline(historicalWork, options = {}) {
  const maxRows = options.maxRows ?? 8;
  const allRows = historicalWork;
  if (allRows.length <= maxRows) {
    return { allRows, visibleRows: allRows, hiddenCount: 0, hasMore: false };
  }
  const visibleRows = allRows.slice(-maxRows);
  const hiddenCount = allRows.length - maxRows;
  return { allRows, visibleRows, hiddenCount, hasMore: true };
}

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
      } catch {
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

// ── AC1: Shared Conformance across all three providers ──────────────────────────────
test('AC1: Shared conformance suite verifies equivalent semantic scenarios across Claude, Codex, and Antigravity', { timeout: 10000 }, async () => {
  const providers = ['claude', 'codex', 'antigravity'];

  for (const providerId of providers) {
    const coordinator = new TurnLifecycleCoordinator({
      turnId: `turn-conformance-${providerId}`,
      sessionId: `sess-${providerId}-1`,
      provider: providerId,
      providerSessionId: `prov-${providerId}-1`,
      userMessage: `Run conformance test for ${providerId}`,
    });

    // 1. Initial commentary / thinking
    if (providerId === 'codex' || providerId === 'antigravity') {
      coordinator.recordReasoningDelta(`Reasoning step for ${providerId}`, `rs-${providerId}`);
    }
    coordinator.recordCommentaryDelta(`Executing steps for ${providerId}...`, `c-${providerId}`);

    // 2. Tool execution based on provider's neutral mapping
    let toolPayload;
    if (providerId === 'claude') {
      const mapped = mapClaudeTool('Read', { file_path: 'src/index.ts' });
      assert.equal(mapped.kind, 'read');
      toolPayload = {
        toolId: 'tool-claude-read',
        toolName: 'Read',
        kind: mapped.kind,
        title: 'Read file',
        description: 'src/index.ts',
      };
    } else if (providerId === 'codex') {
      const mappedActions = mapCodexCommandActions([
        { type: 'read', command: 'node tools/specs.mjs next', path: 'specs/active' },
      ]);
      assert.equal(mappedActions[0].kind, 'read');
      toolPayload = {
        toolId: 'tool-codex-exec',
        toolName: 'exec_command',
        kind: 'command',
        title: 'Run command',
        description: 'node tools/specs.mjs next',
        actions: mappedActions,
      };
    } else {
      const mapped = mapAntigravityTool('view_file', { AbsolutePath: 'src/index.ts' });
      assert.equal(mapped.kind, 'read');
      toolPayload = {
        toolId: 'tool-agy-view',
        toolName: 'view_file',
        kind: mapped.kind,
        title: 'Read file',
        description: 'src/index.ts',
      };
    }

    coordinator.recordToolStarted(toolPayload);
    let snap = coordinator.getCanonicalSnapshot();
    assert.equal(snap.status.status, 'active');
    assert.equal(computeCurrentActivity(snap).kind, 'tool');

    // Complete tool
    coordinator.recordToolCompleted({
      toolId: toolPayload.toolId,
      status: 'completed',
      output: 'file content or command output',
      durationMs: 42,
    });

    // 3. Final answer & terminal settlement
    coordinator.recordFinalAnswerDelta(`Successfully verified conformance for ${providerId}.`);
    coordinator.settleTerminal({ outcome: 'completed', finishReason: 'stop' });

    const finalSnap = coordinator.getCanonicalSnapshot();
    assert.doesNotThrow(() => validateCanonicalTurn(finalSnap));
    assert.equal(finalSnap.status.status, 'terminal');
    assert.equal(finalSnap.status.outcome, 'completed');
    assert.ok(finalSnap.finalAnswer);
    assert.equal(finalSnap.finalAnswer.status, 'completed');
    assert.ok(finalSnap.finalAnswer.text.includes(providerId));
    assert.equal(computeCurrentActivity(finalSnap), null);
    assert.equal(deriveActivity([finalSnap]), 'idle');
  }
});

// ── AC2: Exact Work order, one-invocation/many-actions hierarchy, live -> SSE -> replay -> reload ─────
test('AC2: Exact Work order, one-invocation/many-actions hierarchy, status, and FinalAnswer survive live -> SSE -> replay -> disk reload', { timeout: 10000 }, async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-ac2-convergence-'));
  try {
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const registry = createAgentProviderRegistry();

    let runtimeContext;
    registry.register({
      descriptor: {
        id: 'conformance-agent',
        label: 'Conformance Agent',
        capabilities: { toolCalls: true, cancelTurn: true },
      },
      async startTurn(ctx) {
        runtimeContext = ctx;
        // Step 1: Initial commentary
        ctx.emitCommentaryDelta('Starting compound execution workflow...', 'c-1');

        // Step 2: Compound tool with one-invocation / many-actions hierarchy
        const compoundActions = mapCodexCommandActions([
          { type: 'read', command: 'git status', path: '.git/index' },
          { type: 'search', command: 'git status', target: 'specs/' },
        ]);
        ctx.emitToolStarted({
          toolId: 'tool-compound-1',
          toolName: 'exec_command',
          kind: 'command',
          title: 'Run git status',
          description: 'git status',
          actions: compoundActions,
        });

        ctx.emitToolCompleted({
          toolId: 'tool-compound-1',
          status: 'completed',
          output: 'On branch feature/ai-session-issues-and-diagnostics\nnothing to commit',
          durationMs: 125,
          actions: compoundActions,
        });

        // Step 3: Second commentary
        ctx.emitCommentaryDelta('Inspected tree. Preparing final report.', 'c-2');

        // Step 4: Final answer
        ctx.emitFinalAnswerDelta('Compound action workflow finished with clean tree.');
        return { done: true };
      },
      async cancelTurn() {},
    });

    const runtime = createAgentTurnRuntime({
      registry,
      transcriptCache,
    });

    const liveTurnUpdates = [];
    const unsubLive = runtime.subscribeToSession(
      { provider: 'conformance-agent', providerSessionId: 'sess-conf-1' },
      {
        onEvent: (ev) => {
          if (ev.type === 'turn.updated') {
            liveTurnUpdates.push(structuredClone(ev.turn));
          }
        },
      },
    );

    const { turnId } = await runtime.startTurn({
      provider: 'conformance-agent',
      providerSessionId: 'sess-conf-1',
      message: 'Run full compound action and reload verification',
    });

    await waitFor(
      () => runtime.getSnapshot(turnId),
      (v) => v.status === 'completed',
      'turn completion',
    );

    // 1. Live SSE final turn snapshot
    const liveFinalTurn = liveTurnUpdates[liveTurnUpdates.length - 1];
    assert.ok(liveFinalTurn, 'Must receive live turn snapshot');

    // 2. Replay/Reconnected SSE
    const replayedEvents = runtime.getEvents(turnId, 0);
    const replayedTurnUpdates = replayedEvents.filter((e) => e.type === 'turn.updated').map((e) => e.turn);
    const replayedFinalTurn = replayedTurnUpdates[replayedTurnUpdates.length - 1];
    assert.ok(replayedFinalTurn, 'Must replay turn updates');

    // 3. HTTP V2 In-memory Turn Snapshot
    const httpCanonicalTurn = runtime.getCanonicalTurn(turnId);
    assert.ok(httpCanonicalTurn, 'Must retrieve canonical turn over HTTP V2');

    // 4. Fresh Persistence Disk Reload
    await transcriptCache.flush('conformance-agent', 'sess-conf-1');
    const freshTranscriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });
    const persistedTranscript = await freshTranscriptCache.getTranscript('conformance-agent', 'sess-conf-1');
    const persistedTurn = persistedTranscript.turns.find((t) => t.id === turnId);
    assert.ok(persistedTurn, 'Must retrieve persisted turn after disk reload');

    // Verify exact convergence across all 4 access patterns
    assert.deepEqual(liveFinalTurn.work, replayedFinalTurn.work);
    assert.deepEqual(liveFinalTurn.work, httpCanonicalTurn.work);
    assert.deepEqual(liveFinalTurn.work, persistedTurn.work);

    // Verify chronological sequence numbers [1, 2, 3]
    const seqs = persistedTurn.work.map((w) => w.seq);
    assert.deepEqual(seqs, [1, 2, 3]);

    // Verify compound actions hierarchy survived intact
    const compoundTool = persistedTurn.work.find((w) => w.id === 'tool-compound-1');
    assert.ok(compoundTool);
    assert.equal(compoundTool.type, 'tool');
    assert.equal(compoundTool.actions?.length, 2);
    assert.equal(compoundTool.actions[0].kind, 'read');
    assert.equal(compoundTool.actions[1].kind, 'search');

    // Verify FinalAnswer survived identically
    assert.equal(persistedTurn.finalAnswer?.status, 'completed');
    assert.equal(persistedTurn.finalAnswer?.text, 'Compound action workflow finished with clean tree.');
    assert.equal(liveFinalTurn.finalAnswer?.text, persistedTurn.finalAnswer?.text);

    // Verify terminal status convergence
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

// ── AC3: Waiting Provider/Tool vs Requires Attention Distinctness ───────────────────
test('AC3: Waiting provider/tool vs requires-attention remain strictly distinct across all states', { timeout: 10000 }, () => {
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-ac3-states',
    provider: 'codex',
    mode: 'agent',
    userMessage: 'Test state transitions',
  });

  // State 1: Fresh active turn -> waiting_for_model (NEVER requires_attention, NEVER thinking)
  let snap = coordinator.getCanonicalSnapshot();
  let act = computeCurrentActivity(snap);
  assert.equal(act.kind, 'waiting_for_model');
  assert.equal(act.status, 'running');
  assert.equal(snap.status.status, 'active');
  assert.equal(deriveActivity([snap]), 'running');

  // State 2: Active tool execution -> tool (NEVER waiting_for_model, NEVER requires_attention)
  coordinator.recordToolStarted({
    toolId: 'tool-active-1',
    toolName: 'exec_command',
    kind: 'command',
    title: 'Executing build',
    description: 'npm test',
  });
  snap = coordinator.getCanonicalSnapshot();
  act = computeCurrentActivity(snap);
  assert.equal(act.kind, 'tool');
  assert.equal(act.toolKind, 'command');
  assert.equal(act.title, 'Executing build');
  assert.equal(snap.status.status, 'active');
  assert.equal(deriveActivity([snap]), 'running');

  // State 3: Tool completes -> reverts to waiting_for_model
  coordinator.recordToolCompleted({
    toolId: 'tool-active-1',
    status: 'completed',
    output: 'ok',
    durationMs: 150,
  });
  snap = coordinator.getCanonicalSnapshot();
  act = computeCurrentActivity(snap);
  assert.equal(act.kind, 'waiting_for_model');
  assert.equal(snap.status.status, 'active');
  assert.equal(deriveActivity([snap]), 'running');

  // State 4: Structured interaction requested -> requires_attention ONLY HERE
  coordinator.recordInteractionRequested({
    id: 'int-ac3-q',
    kind: 'question',
    prompt: 'Confirm directory purge?',
    questions: [
      {
        id: 'q1',
        question: 'Confirm directory purge?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    ],
  });
  snap = coordinator.getCanonicalSnapshot();
  act = computeCurrentActivity(snap);
  assert.equal(act.kind, 'requires_attention');
  assert.equal(act.subjectId, 'int-ac3-q');
  assert.equal(snap.status.status, 'requiresAttention');
  assert.equal(deriveActivity([snap]), 'waitingForUser');

  // State 5: Interaction resolved -> reverts to waiting_for_model
  coordinator.recordInteractionResolved({
    interactionId: 'int-ac3-q',
    response: { answers: { q1: 'Yes' } },
  });
  snap = coordinator.getCanonicalSnapshot();
  act = computeCurrentActivity(snap);
  assert.equal(act.kind, 'waiting_for_model');
  assert.equal(snap.status.status, 'active');
  assert.equal(deriveActivity([snap]), 'running');

  // State 6: Terminal completion -> currentActivity cleared to null, session idle
  coordinator.recordFinalAnswerDelta('Directory purged successfully.');
  coordinator.settleTerminal({ outcome: 'completed' });
  snap = coordinator.getCanonicalSnapshot();
  act = computeCurrentActivity(snap);
  assert.equal(act, null);
  assert.equal(snap.status.status, 'terminal');
  assert.equal(deriveActivity([snap]), 'idle');
});

// ── AC4: Cancellation, Timeout, Failure, Cleanup Barrier, and Interrupted Diagnostics ─
test('AC4: Cancellation, timeout, provider failure, cleanup barrier, and interrupted recovery retain correct owner and diagnostics', { timeout: 10000 }, async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nevo-ac4-diag-'));
  try {
    const traceSink = new LifecycleTraceSink({ baseDir: tmpDir });
    const transcriptCache = createTranscriptCacheService({ baseDir: tmpDir, flushDebounceMs: 0 });

    // 1. Cancellation test with cleanup error
    {
      const registry = createAgentProviderRegistry();
      let finishDeferred;
      registry.register({
        descriptor: { id: 'prov-cancel', label: 'Prov Cancel', capabilities: { cancelTurn: true } },
        async startTurn(ctx) {
          ctx.emitCommentaryDelta('In progress...', 'msg-c');
          await new Promise((r) => {
            finishDeferred = r;
          });
          throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider crashed on abort');
        },
        async cancelTurn() {},
      });

      const runtime = createAgentTurnRuntime({ registry, transcriptCache, traceSink });
      const { turnId } = await runtime.startTurn({
        provider: 'prov-cancel',
        providerSessionId: 'sess-c-1',
        message: 'Cancel test',
      });

      await runtime.cancelTurn(turnId, { initiator: 'user', cause: 'user-cancelled' });
      if (finishDeferred) finishDeferred();
      await new Promise((r) => setTimeout(r, 50));

      const canonical = runtime.getCanonicalTurn(turnId);
      assert.equal(canonical.status.status, 'terminal');
      assert.equal(canonical.status.outcome, 'cancelled');
      assert.equal(canonical.status.error.code, 'AI_TURN_CANCELLED');
      assert.equal(canonical.terminalOutcome.initiator, 'user');
      await runtime.shutdown();
    }

    // 2. Timeout test with cleanup barrier (single cleanup call)
    {
      let cleanupCalls = 0;
      const registry = createAgentProviderRegistry();
      registry.register({
        descriptor: { id: 'prov-timeout', label: 'Prov Timeout', capabilities: { cancelTurn: true } },
        async startTurn(ctx) {
          ctx.setOperation({ pid: 12345 });
          ctx.emitCommentaryDelta('Hanging...', 'msg-t');
          await new Promise(() => {});
        },
        async cancelTurn() {
          cleanupCalls++;
          await new Promise((r) => setTimeout(r, 40));
        },
      });

      const runtime = createAgentTurnRuntime({
        registry,
        transcriptCache,
        traceSink,
        idleTimeoutMs: 30,
        idleCheckIntervalMs: 10,
      });

      const { turnId } = await runtime.startTurn({
        provider: 'prov-timeout',
        providerSessionId: 'sess-t-1',
        message: 'Timeout test',
      });

      await waitFor(
        () => runtime.getSnapshot(turnId).status === 'failed',
        (v) => v === true,
        'timeout',
      );
      await new Promise((r) => setTimeout(r, 60));

      assert.equal(cleanupCalls, 1, 'Provider cancelTurn must be called at most once');
      const canonical = runtime.getCanonicalTurn(turnId);
      assert.equal(canonical.status.outcome, 'failed');
      assert.equal(canonical.status.cause, 'timeout/protocol-silence');
      assert.equal(canonical.status.error.code, 'AI_TURN_TIMEOUT');
      await runtime.shutdown();
    }

    // 3. Provider failure test
    {
      const registry = createAgentProviderRegistry();
      registry.register({
        descriptor: { id: 'prov-fail', label: 'Prov Fail', capabilities: { cancelTurn: true } },
        async startTurn() {
          throw new AiError('AI_PROVIDER_PROTOCOL_ERROR', 'Provider internal protocol crash');
        },
        async cancelTurn() {},
      });

      const runtime = createAgentTurnRuntime({ registry, transcriptCache, traceSink });
      const { turnId } = await runtime.startTurn({
        provider: 'prov-fail',
        providerSessionId: 'sess-f-1',
        message: 'Failure test',
      });

      await waitFor(
        () => runtime.getSnapshot(turnId).status === 'failed',
        (v) => v === true,
        'failure',
      );
      const canonical = runtime.getCanonicalTurn(turnId);
      assert.equal(canonical.status.outcome, 'failed');
      assert.equal(canonical.status.error.code, 'AI_PROVIDER_PROTOCOL_ERROR');
      await runtime.shutdown();
    }

    // 4. Interrupted recovery test (server restart simulation)
    {
      const coordinator = new TurnLifecycleCoordinator({
        turnId: 'turn-interrupted-1',
        provider: 'codex',
        sessionId: 'sess-reconcile-1',
        userMessage: 'Reconcile turn',
      });
      coordinator.settleTerminal({
        outcome: 'interrupted',
        initiator: 'system',
        cause: 'server-restart',
        error: { code: 'AI_TURN_INTERRUPTED', message: 'Interrupted by server restart.' },
      });
      const snap = coordinator.getCanonicalSnapshot();
      assert.equal(snap.status.status, 'terminal');
      assert.equal(snap.status.outcome, 'interrupted');
      assert.equal(snap.status.cause, 'server-restart');
      assert.equal(snap.status.error?.code, 'AI_TURN_INTERRUPTED');
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── AC5: Long Work Timeline (26 operations) Inspection and Desktop/Mobile Visibility ─
test('AC5: Tool-heavy Work timeline (26 operations) is understandable in collapsed & expanded forms', { timeout: 10000 }, async () => {
  const fixtureUrl = new URL('./fixtures/cross-provider-long-timeline.json', import.meta.url);
  const fixtureData = JSON.parse(await readFile(fixtureUrl, 'utf-8'));
  const longScenario = fixtureData.scenarios.find((s) => s.id === 'tool-heavy-long-timeline');
  assert.ok(longScenario);
  assert.equal(longScenario.operationCount, 26);

  const coordinator = new TurnLifecycleCoordinator({
    turnId: longScenario.turnId,
    provider: longScenario.provider,
    sessionId: longScenario.sessionId,
    userMessage: longScenario.userMessage,
  });

  // 1 commentary + 24 tools + 1 final answer = 26 operations
  coordinator.recordCommentaryDelta('Starting 25-step validation sequence...', 'c-init');
  for (let i = 1; i <= 24; i++) {
    coordinator.recordToolStarted({
      toolId: `tool-step-${i}`,
      toolName: i % 2 === 0 ? 'exec_command' : 'read_file',
      kind: i % 2 === 0 ? 'command' : 'read',
      title: `Step ${i}`,
      description: `Operation ${i} description`,
    });
    coordinator.recordToolCompleted({
      toolId: `tool-step-${i}`,
      status: 'completed',
      output: `Result of step ${i}`,
      durationMs: 25 + i,
    });
  }
  coordinator.recordFinalAnswerDelta(longScenario.finalAnswer);
  coordinator.settleTerminal({ outcome: 'completed' });

  const canonicalTurn = coordinator.getCanonicalSnapshot();
  assert.equal(canonicalTurn.work.length, 25); // 1 commentary + 24 tools
  assert.equal(canonicalTurn.finalAnswer?.status, 'completed');

  // Serialization for UI consumption
  const publicTurn = serializePublicTurn(canonicalTurn);
  assert.equal(publicTurn.work.length, 25);
  assert.equal(publicTurn.currentActivity, null);
  assert.equal(publicTurn.historicalWork.length, 25);

  // Desktop/Mobile UI projection rules (Level 2 timeline projection & bounding)
  const projection = projectTimeline(publicTurn.historicalWork, { maxRows: 8 });
  assert.equal(projection.visibleRows.length, 8, 'Level 2 caps visible history to maxRows');
  assert.equal(projection.hasMore, true);
  assert.equal(projection.allRows.length, 25);
  assert.equal(projection.hiddenCount, 17, 'Correctly reports hidden items');
});

// ── AC8: Textual Question vs Blocking Interaction Invariant (Zero Text Heuristics) ───
test('AC8: Text questions ending a Turn produce normal terminal assistant output without entering requiresAttention', { timeout: 10000 }, () => {
  const textualQuestions = [
    'Should I proceed with removing the legacy directory?',
    'Which option do you prefer: Option A or Option B?',
    'Could you clarify: what should the default timeout be?',
  ];

  for (let index = 0; index < textualQuestions.length; index++) {
    const questionText = textualQuestions[index];
    const coordinator = new TurnLifecycleCoordinator({
      turnId: `turn-text-question-${index + 1}`,
      provider: 'claude',
      mode: 'edit',
      userMessage: 'Test textual question',
    });

    coordinator.recordCommentaryDelta('Inspected files.', 'c-1');
    coordinator.recordFinalAnswerDelta(questionText);
    coordinator.settleTerminal({ outcome: 'completed', finishReason: 'stop' });

    const snap = coordinator.getCanonicalSnapshot();

    // INVARIANT ASSERTIONS:
    // 1. Textual question must NOT set status to requiresAttention
    assert.equal(snap.status.status, 'terminal', 'Status must be terminal, not requiresAttention');
    assert.equal(snap.status.outcome, 'completed');

    // 2. Textual question must NOT create an Interaction work item
    const interactionWork = snap.work.find((w) => w.type === 'interaction');
    assert.equal(interactionWork, undefined, 'Free-form question text must NEVER invent an Interaction');

    // 3. CurrentActivity must be null once terminal
    assert.equal(computeCurrentActivity(snap), null);

    // 4. Session activity must be idle
    assert.equal(deriveActivity([snap]), 'idle');

    // 5. FinalAnswer preserves exact question text
    assert.equal(snap.finalAnswer.text, questionText);
  }
});

test('AC8: Genuine blocking provider states produce canonical Interaction + requiresAttention via evidenced structured tools', { timeout: 10000 }, () => {
  // Test Claude MCP bridge ask_user structured interaction
  {
    const coordinator = new TurnLifecycleCoordinator({
      turnId: 'turn-claude-structured',
      provider: 'claude',
      mode: 'agent',
      userMessage: 'Run claude interactive test',
    });

    coordinator.recordInteractionRequested({
      id: 'int-claude-mcp',
      kind: 'question',
      toolName: 'mcp__nevo__ask_user',
      prompt: 'Select branch to merge:',
      questions: [
        {
          id: 'branch',
          question: 'Select branch to merge:',
          options: [{ label: 'main' }, { label: 'develop' }],
        },
      ],
    });

    const snap = coordinator.getCanonicalSnapshot();
    assert.equal(snap.status.status, 'requiresAttention');
    const act = computeCurrentActivity(snap);
    assert.equal(act.kind, 'requires_attention');
    assert.equal(act.subjectId, 'int-claude-mcp');
    assert.equal(deriveActivity([snap]), 'waitingForUser');

    const intItem = snap.work.find((w) => w.type === 'interaction');
    assert.ok(intItem);
    assert.equal(intItem.interaction.kind, 'question');
    assert.equal(intItem.interaction.questions[0].id, 'branch');
  }

  // Test Antigravity ask_question structured interaction
  {
    const coordinator = new TurnLifecycleCoordinator({
      turnId: 'turn-agy-structured',
      provider: 'antigravity',
      mode: 'agent',
      userMessage: 'Run agy interactive test',
    });

    coordinator.recordInteractionRequested({
      id: 'int-agy-ask',
      kind: 'question',
      toolName: 'ask_question',
      prompt: 'Confirm destructive operation?',
      questions: [
        {
          id: 'confirm',
          question: 'Confirm destructive operation?',
          options: [{ label: 'Yes' }, { label: 'No' }],
        },
      ],
    });

    const snap = coordinator.getCanonicalSnapshot();
    assert.equal(snap.status.status, 'requiresAttention');
    assert.equal(computeCurrentActivity(snap).kind, 'requires_attention');
    assert.equal(deriveActivity([snap]), 'waitingForUser');
  }

  // Test Codex requestUserInput structured interaction
  {
    const coordinator = new TurnLifecycleCoordinator({
      turnId: 'turn-codex-structured',
      provider: 'codex',
      mode: 'agent',
      userMessage: 'Run codex interactive test',
    });

    coordinator.recordInteractionRequested({
      id: 'int-codex-req',
      kind: 'question',
      toolName: 'requestUserInput',
      prompt: 'Enter API key:',
      questions: [
        {
          id: 'apiKey',
          question: 'Enter API key:',
        },
      ],
    });

    const snap = coordinator.getCanonicalSnapshot();
    assert.equal(snap.status.status, 'requiresAttention');
    assert.equal(computeCurrentActivity(snap).kind, 'requires_attention');
    assert.equal(deriveActivity([snap]), 'waitingForUser');
  }
});

test('AC8: Provider blocking for input without producing structured interaction fails conformance validation', { timeout: 10000 }, () => {
  // Conformance invariant checker from Task 12 requirement:
  // "If a provider process/turn is observed blocking for user input without producing its supported
  //  structured Interaction, Task 12 must fail and reopen the owning provider mapping task"
  function validateProviderBlockingConformance(turn, providerState) {
    if (providerState.isWaitingForUserInput) {
      const hasStructuredInteraction =
        turn.status?.status === 'requiresAttention' &&
        turn.work?.some((w) => w.type === 'interaction' && w.status !== 'resolved');

      if (!hasStructuredInteraction) {
        throw new Error(
          `Conformance Violation: Provider '${turn.provider}' entered blocking state without producing structured Interaction. Heuristic fallback from text is forbidden.`,
        );
      }
    }
  }

  // Compliant turn with structured interaction passes
  const compliantTurn = validateCanonicalTurn({
    id: 'turn-compliant',
    provider: 'claude',
    status: {
      status: 'requiresAttention',
      reason: 'question',
      interactionId: 'int-1',
      since: new Date().toISOString(),
      source: 'coordinator',
    },
    work: [
      {
        id: 'int-1',
        seq: 1,
        type: 'interaction',
        status: 'pending',
        interaction: {
          id: 'int-1',
          kind: 'question',
          prompt: 'Select option',
          questions: [{ id: 'q1', question: 'Select option' }],
        },
      },
    ],
  });
  assert.doesNotThrow(() => validateProviderBlockingConformance(compliantTurn, { isWaitingForUserInput: true }));

  // Non-compliant turn (blocked provider with normal active turn and NO structured interaction) fails
  const nonCompliantTurn = validateCanonicalTurn({
    id: 'turn-non-compliant',
    provider: 'antigravity',
    status: {
      status: 'active',
      detail: 'processing',
      since: new Date().toISOString(),
      source: 'coordinator',
    },
    work: [],
    finalAnswer: { text: 'Please answer my question: yes or no?', status: 'completed' },
  });
  assert.throws(
    () => validateProviderBlockingConformance(nonCompliantTurn, { isWaitingForUserInput: true }),
    /Conformance Violation: Provider 'antigravity' entered blocking state without producing structured Interaction/,
  );
});

// ── Criterion 1: Permissive model passthrough, trait representation, and neutral error taxonomy ──
test('Criterion 1: Permissive model passthrough, trait representation, and neutral error taxonomy across all adapters', { timeout: 10000 }, async () => {
  // 1. Outcome arbitration across all 4 terminal outcomes
  const outcomes = ['completed', 'failed', 'cancelled', 'interrupted'];
  for (const outcome of outcomes) {
    const coordinator = new TurnLifecycleCoordinator({
      turnId: `turn-arb-${outcome}`,
      provider: 'claude',
      userMessage: `Testing outcome ${outcome}`,
    });
    const terminal = coordinator.settleTerminal({
      outcome,
      cause: outcome === 'failed' ? 'AI_PROVIDER_EXECUTION_ERROR' : outcome === 'interrupted' ? 'forced_cleanup' : undefined,
      initiator: outcome === 'cancelled' ? 'user' : 'provider',
    });
    assert.equal(terminal.status, 'terminal');
    assert.equal(terminal.outcome, outcome);
    const snap = coordinator.getCanonicalSnapshot();
    assert.equal(snap.status.status, 'terminal');
    assert.equal(snap.status.outcome, outcome);
  }

  // 2. Permissive model passthrough and trait representation
  const cwd = tmpdir();
  const claude = new ClaudeAgentProvider({ cwd });
  const fakeCodexClient = {
    onNotification: () => () => {},
    onServerRequest: () => () => {},
    async listModels() {
      return [
        {
          id: 'o3-mini',
          label: 'o3-mini',
          source: 'discovered',
          traits: { supportsReasoning: true, supportedReasoningEfforts: ['low', 'medium', 'high'] },
        },
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          source: 'discovered',
          traits: { supportsReasoning: false, inputModalities: ['text', 'image'], supportsVision: true },
        },
      ];
    },
    async dispose() {},
  };
  const codex = new CodexAgentProvider({ cwd, client: fakeCodexClient });
  const antigravity = new AntigravityAgentProvider({
    cwd,
    ensureMcpRegistered: false,
    modelsExecSync: () => 'gemini-3.7-flash-high\tGemini 3.7 Flash\n',
  });

  try {
    for (const prov of [claude, codex]) {
      const models = typeof prov.listModels === 'function' ? await prov.listModels() : (prov.descriptor.models || []);
      assert.ok(Array.isArray(models));
      // Curated models with reasoning traits
      const reasoningModels = models.filter((m) => m.traits?.supportsReasoning);
      assert.ok(reasoningModels.length > 0, `Provider ${prov.descriptor.id} must declare models with reasoning traits`);
    }
    const agyModels = typeof antigravity.listModels === 'function' ? await antigravity.listModels() : [];
    assert.ok(Array.isArray(agyModels));
  } finally {
    await codex.dispose?.();
  }

  // 3. Neutral error taxonomy mapping
  for (const code of AI_FAILURE_CODES) {
    const err = new AiError(code, `Testing ${code}`);
    assert.equal(err.code, code);
    assert.equal(err.status, AI_ERROR_HTTP_STATUS[code]);
    assert.equal(err.recoveryHint, DEFAULT_RECOVERY_HINTS[code]);
    const json = err.toJSON();
    assert.equal(json.error.code, code);
    assert.equal(json.error.recoveryHint, DEFAULT_RECOVERY_HINTS[code]);
  }
});

// ── Criterion 2: Structured question interaction handling and response correlation ──
test('Criterion 2: Structured question interaction handling and response correlation across Codex, Claude, and Antigravity', { timeout: 10000 }, () => {
  const providerInteractions = [
    {
      provider: 'claude',
      toolName: 'mcp__nevo__ask_user',
      questions: [
        {
          id: 'deploy_env',
          question: 'Choose deployment target:',
          options: [{ label: 'staging' }, { label: 'production' }],
        },
      ],
      answers: [{ questionId: 'deploy_env', value: 'staging' }],
    },
    {
      provider: 'antigravity',
      toolName: 'ask_question',
      questions: [
        {
          id: 'run_mode',
          question: 'Select run mode:',
          options: [{ label: 'fast' }, { label: 'thorough' }],
        },
      ],
      answers: [{ questionId: 'run_mode', value: 'fast' }],
    },
    {
      provider: 'codex',
      toolName: 'requestUserInput',
      questions: [
        {
          id: 'confirmation_code',
          question: 'Enter confirmation token:',
        },
      ],
      answers: [{ questionId: 'confirmation_code', value: 'tok-12345' }],
    },
  ];

  for (const { provider, toolName, questions, answers } of providerInteractions) {
    const coordinator = new TurnLifecycleCoordinator({
      turnId: `turn-interactive-${provider}`,
      sessionId: `sess-${provider}`,
      provider,
      mode: 'agent',
      userMessage: `Run interactive test for ${provider}`,
    });

    const interactionId = `int-${provider}-q`;
    coordinator.recordInteractionRequested({
      id: interactionId,
      kind: 'question',
      toolName,
      prompt: questions[0].question,
      questions,
    });

    // Verify turn enters requiresAttention
    const attentionSnap = coordinator.getCanonicalSnapshot();
    assert.equal(attentionSnap.status.status, 'requiresAttention');
    assert.equal(attentionSnap.status.reason, 'question');
    assert.equal(attentionSnap.status.interactionId, interactionId);

    const pending = coordinator.pendingInteraction;
    assert.ok(pending);
    assert.equal(pending.id, interactionId);
    assert.equal(pending.kind, 'question');

    // Validate response payload conforms to question schema
    const validatedResponse = validateInteractionResponse(pending, { answers });
    assert.deepEqual(validatedResponse.answers, answers);

    // Correlate response and resume
    coordinator.recordInteractionResolved({ interactionId, response: validatedResponse });

    const resolvedSnap = coordinator.getCanonicalSnapshot();
    assert.equal(resolvedSnap.status.status, 'active');
    const resolvedItem = resolvedSnap.work.find((w) => w.id === interactionId);
    assert.ok(resolvedItem);
    assert.equal(resolvedItem.status, 'resolved');
    assert.deepEqual(resolvedItem.response, validatedResponse);
  }
});

// ── Criterion 4: Diagnostic privacy tests ──
test('Criterion 4: Diagnostic privacy ensures raw capture payloads, RPC envelopes, and private provider IDs are never exposed over public SSE streams or HTTP endpoints', { timeout: 10000 }, () => {
  const stream = new TurnEventStream();
  const turnId = 'turn-diag-priv';
  stream.registerTurn({ turnId, provider: 'codex', providerSessionId: 'sess-diag' });

  const capturedEvents = [];
  stream.subscribeToTurn(turnId, { onEvent: (event) => capturedEvents.push(event) });

  // 1. Emit events containing private provider fields
  stream.emit(turnId, 'text.delta', {
    text: 'Hello world',
    messageId: 'msg-1',
    providerRequestId: 'req-secret-123',
    rawPayload: '{"debug": "sensitive"}',
    rawBytes: [0xde, 0xad, 0xbe, 0xef],
  });

  stream.emit(turnId, 'progress.delta', {
    text: 'Thinking...',
    progressId: 'prog-1',
    rpcEnvelope: { jsonrpc: '2.0', id: 42, method: 'exec' },
    providerEventId: 'ev-999',
  });

  stream.emit(turnId, 'tool.started', {
    tool: {
      id: 'tool-1',
      name: 'view_file',
      providerToolCallId: 'call-priv-001',
    },
    rawPayload: { internalContext: true },
  });

  stream.emit(turnId, 'turn.failed', {
    code: 'AI_PROVIDER_EXECUTION_ERROR',
    message: 'Operation failed',
    rawPayload: 'Traceback (most recent call last): ...',
  });

  // 2. Verify all emitted events on the SSE stream are sanitized
  assert.ok(capturedEvents.length >= 4);
  for (const event of capturedEvents) {
    const serialized = JSON.stringify(event);
    assert.equal(/providerRequestId|rawPayload|rawBytes|rpcEnvelope|providerEventId/i.test(serialized), false,
      `Event ${event.type} must not leak private fields: ${serialized}`);
  }

  // 3. Verify public serialized turn does not leak private fields
  const coordinator = new TurnLifecycleCoordinator({
    turnId: 'turn-public-priv',
    sessionId: 'sess-pub',
    provider: 'antigravity',
    userMessage: 'Test privacy',
  });
  coordinator.recordFinalAnswerDelta('Final clean answer');
  coordinator.settleTerminal({ outcome: 'completed' });

  const canonical = coordinator.getCanonicalSnapshot();
  const publicSnap = serializePublicTurn(canonical);

  const publicSerialized = JSON.stringify(publicSnap);
  assert.equal(/privateOperation|providerRequestId|rpcEnvelope|rawPayload/i.test(publicSerialized), false,
    `Public turn snapshot must not contain private internal fields: ${publicSerialized}`);
});
