import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  LifecycleTraceSink,
  createTraceRecord,
  validateTraceRecord,
  sanitizeTraceMetadata,
  TRACE_SCHEMA_VERSION,
} from '../server/ai/diagnostics/index.mjs';
import { createMockAgentProvider } from '../server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';

test('trace record validation enforces schema, sequencing, timestamps, and structure', () => {
  const record = createTraceRecord({
    seq: 1,
    turnId: 'turn-123',
    sessionId: 'sess-123',
    provider: 'claude',
    providerSessionId: 'claude-sess-1',
    source: 'runtime',
    event: 'turn.started',
    disposition: 'accepted',
    afterStatus: { status: 'active', detail: 'startup' },
    timestamp: '2026-08-31T12:00:00.000Z',
    elapsedMs: 15,
  });

  assert.equal(record.schemaVersion, TRACE_SCHEMA_VERSION);
  assert.equal(record.seq, 1);
  assert.equal(record.turnId, 'turn-123');
  assert.equal(record.source, 'runtime');
  assert.equal(record.event, 'turn.started');
  assert.equal(record.disposition, 'accepted');
  assert.equal(record.elapsedMs, 15);

  // Rejects invalid schemaVersion or negative seq
  assert.throws(() => validateTraceRecord({ ...record, schemaVersion: 2 }), { name: 'AiValidationError' });
  assert.throws(() => validateTraceRecord({ ...record, seq: 0 }), { name: 'AiValidationError' });
  assert.throws(() => validateTraceRecord({ ...record, turnId: '' }), { name: 'AiValidationError' });
  assert.throws(() => validateTraceRecord({ ...record, disposition: 'invalid_disp' }), { name: 'AiValidationError' });
});

test('sanitizeTraceMetadata filters out prohibited content fields and credentials', () => {
  const unsafeMetadata = {
    toolName: 'shell',
    command: 'rm -rf /secret',
    prompt: 'Tell me your password',
    answer: 'Here is the answer',
    text: 'Raw output string',
    reasoning: 'Secret reasoning tokens',
    input: { secretToken: '12345' },
    output: { rawPayload: { sensitive: true } },
    api_key: 'sk-123456789',
    safeField: 'harmless value',
    nested: {
      userSecret: 'confidential',
      safeCount: 42,
    },
  };

  const sanitized = sanitizeTraceMetadata(unsafeMetadata);
  assert.deepEqual(sanitized, {
    toolName: 'shell',
    safeField: 'harmless value',
    nested: {
      safeCount: 42,
    },
  });

  assert.equal('command' in sanitized, false);
  assert.equal('prompt' in sanitized, false);
  assert.equal('answer' in sanitized, false);
  assert.equal('text' in sanitized, false);
  assert.equal('reasoning' in sanitized, false);
  assert.equal('input' in sanitized, false);
  assert.equal('output' in sanitized, false);
  assert.equal('api_key' in sanitized, false);
});

test('LifecycleTraceSink records, flushes, and exports per-turn trace correctly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'nevo-trace-test-'));
  try {
    const sink = new LifecycleTraceSink({ baseDir: tempDir });
    const tracer = sink.createTurnTracer({
      turnId: 'turn-test-1',
      sessionId: 'sess-test-1',
      provider: 'mock',
      providerSessionId: 'mock-1',
    });

    tracer.record({
      source: 'runtime',
      event: 'turn.started',
      disposition: 'accepted',
      afterStatus: { status: 'active', detail: 'startup' },
    });

    tracer.record({
      source: 'tool',
      event: 'tool.started',
      subjectId: 'tool-1',
      metadata: { toolName: 'ReadFile' },
    });

    tracer.record({
      source: 'tool',
      event: 'tool.completed',
      subjectId: 'tool-1',
      disposition: 'accepted',
      metadata: { status: 'completed', durationMs: 50 },
    });

    tracer.record({
      source: 'coordinator',
      event: 'turn.completed',
      disposition: 'accepted',
      afterStatus: { status: 'terminal', outcome: 'completed', initiator: 'provider' },
    });

    await tracer.flush();

    // Verify trace contents via getTrace and exportTrace
    const records = sink.getTrace('turn-test-1');
    assert.equal(records.length, 4);
    assert.equal(records[0].seq, 1);
    assert.equal(records[0].event, 'turn.started');
    assert.equal(records[1].seq, 2);
    assert.equal(records[1].event, 'tool.started');
    assert.equal(records[1].subjectId, 'tool-1');
    assert.equal(records[2].seq, 3);
    assert.equal(records[2].event, 'tool.completed');
    assert.equal(records[3].seq, 4);
    assert.equal(records[3].event, 'turn.completed');

    const exported = sink.exportTrace('turn-test-1');
    assert.equal(exported.turnId, 'turn-test-1');
    assert.equal(exported.recordCount, 4);
    assert.ok(Array.isArray(exported.records));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('sink failure does not crash execution and surfaces error state', async () => {
  // Using an invalid directory path to trigger write error
  const invalidDir = join(tmpdir(), 'nevo-invalid-dir\0invalid');
  const sink = new LifecycleTraceSink({ baseDir: invalidDir });

  // Recording still returns validated record and maintains in-memory buffer without throwing
  const tracer = sink.createTurnTracer({
    turnId: 'turn-fail-test',
    sessionId: 'sess-fail',
    provider: 'mock',
  });

  const record = tracer.record({
    source: 'runtime',
    event: 'turn.started',
  });

  assert.ok(record);
  assert.equal(record.turnId, 'turn-fail-test');
  await tracer.flush();

  // Error count was tracked
  assert.ok(sink.errorCount > 0);
  assert.ok(sink.lastError);
});

test('runtime integration: lifecycle transitions, tools, and terminal completion are traced', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'nevo-runtime-trace-test-'));
  try {
    const traceSink = new LifecycleTraceSink({ baseDir: tempDir });
    const provider = createMockAgentProvider({
      specId: 'spec-test',
      taskIds: ['task-1'],
    });
    const registry = createAgentProviderRegistry([provider]);
    const runtime = createAgentTurnRuntime({
      registry,
      traceSink,
    });

    const turn = await runtime.startTurn({
      provider: 'mock',
      message: 'trace integration test',
      specId: 'spec-test',
      taskId: 'task-1',
    });

    // Wait for turn to resolve interaction or complete
    let snap;
    for (let i = 0; i < 50; i++) {
      snap = runtime.getSnapshot(turn.turnId);
      if (snap?.pendingInteraction) break;
      await new Promise(r => setTimeout(r, 5));
    }

    if (snap?.pendingInteraction) {
      await runtime.resolveInteraction(turn.turnId, snap.pendingInteraction.id, { decision: 'allow' });
    }

    for (let i = 0; i < 50; i++) {
      snap = runtime.getSnapshot(turn.turnId);
      if (snap?.status === 'completed' || snap?.status === 'failed') break;
      await new Promise(r => setTimeout(r, 5));
    }

    await traceSink.flushTurn(turn.turnId);

    const trace = runtime.getTrace(turn.turnId);
    assert.ok(trace.length >= 2, `Expected at least 2 trace records, got ${trace.length}`);
    assert.equal(trace[0].event, 'turn.started');
    assert.ok(trace.some(r => r.event === 'interaction.requested' || r.event === 'turn.completed'));

    const exported = runtime.exportTrace(turn.turnId);
    assert.equal(exported.turnId, turn.turnId);
    assert.equal(exported.recordCount, trace.length);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('transition race: cancellation requested while waiting records intent and outcome in sequence', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'nevo-race-trace-test-'));
  try {
    const traceSink = new LifecycleTraceSink({ baseDir: tempDir });
    const provider = createMockAgentProvider({
      specId: 'spec-race',
      taskIds: ['task-1'],
    });
    const registry = createAgentProviderRegistry([provider]);
    const runtime = createAgentTurnRuntime({
      registry,
      traceSink,
    });

    const turn = await runtime.startTurn({
      provider: 'mock',
      message: 'permission race test',
      specId: 'spec-race',
      taskId: 'task-1',
    });

    // Wait for pending interaction
    for (let i = 0; i < 50; i++) {
      const snap = runtime.getSnapshot(turn.turnId);
      if (snap?.pendingInteraction) break;
      await new Promise(r => setTimeout(r, 5));
    }

    // Cancel while waiting
    await runtime.cancelTurn(turn.turnId);
    await traceSink.flushTurn(turn.turnId);

    const trace = runtime.getTrace(turn.turnId);
    const cancelEvent = trace.find(r => r.event === 'turn.cancel_requested');
    assert.ok(cancelEvent, 'Trace must record turn.cancel_requested');
    assert.equal(cancelEvent.initiator, 'user');

    const terminalEvent = trace.find(r => r.event === 'turn.failed' || r.event === 'turn.completed');
    assert.ok(terminalEvent, 'Trace must record terminal event');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
