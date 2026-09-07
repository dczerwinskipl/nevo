import test from 'node:test';
import assert from 'node:assert/strict';

import { createOperationRuntime } from '../server/infrastructure/operation-runtime.mjs';

test('Dashboard Operations UI Integration and Contract (Task 07)', async (t) => {
  await t.test('operation runtime supports snapshot recovery for fast completed operations', () => {
    const runtime = createOperationRuntime();
    const opId = runtime.createOperation({ type: 'approve' });

    runtime.recordEvent(opId, {
      type: 'operation.started',
      steps: [
        { id: 'validate-approval', label: 'Validate approval' },
        { id: 'approve-task', label: 'Approve task' },
        { id: 'rebuild-metadata', label: 'Rebuild spec metadata' },
        { id: 'commit-approval', label: 'Commit approval' },
        { id: 'push-approval', label: 'Push approval' },
      ],
    });

    runtime.recordEvent(opId, { type: 'operation.step.started', id: 'validate-approval', label: 'Validate approval' });
    runtime.recordEvent(opId, { type: 'operation.step.completed', id: 'validate-approval' });
    runtime.recordEvent(opId, { type: 'operation.step.started', id: 'approve-task', label: 'Approve task' });
    runtime.recordEvent(opId, { type: 'operation.step.completed', id: 'approve-task' });
    runtime.completeOperation(opId, { summary: 'Task marked as approved.' });

    // Client connects after operation is already terminal
    const snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.status, 'completed');
    assert.equal(snapshot.type, 'approve');
    assert.equal(snapshot.steps.length, 5);
    assert.equal(snapshot.steps[0].status, 'completed');
    assert.equal(snapshot.steps[1].status, 'completed');
    assert.equal(snapshot.result.summary, 'Task marked as approved.');
  });

  await t.test('operation runtime preserves pending status for unexecuted steps on failure', () => {
    const runtime = createOperationRuntime();
    const opId = runtime.createOperation({ type: 'finalize' });

    runtime.recordEvent(opId, {
      type: 'operation.started',
      steps: [
        { id: 'load-pr-review', label: 'Load PR review state' },
        { id: 'evaluate-finalize-gate', label: 'Evaluate finalize gate' },
        { id: 'archive-spec', label: 'Archive specification' },
        { id: 'commit-and-push', label: 'Commit and push changes' },
        { id: 'merge-pull-request', label: 'Merge pull request' },
      ],
    });

    runtime.recordEvent(opId, { type: 'operation.step.started', id: 'load-pr-review' });
    runtime.recordEvent(opId, { type: 'operation.step.completed', id: 'load-pr-review' });

    runtime.recordEvent(opId, { type: 'operation.step.started', id: 'evaluate-finalize-gate' });
    runtime.failOperation(opId, { message: '3 unresolved review threads on PR #42' });

    const snapshot = runtime.getSnapshot(opId);
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.error.message, '3 unresolved review threads on PR #42');

    // Step 1: completed
    assert.equal(snapshot.steps[0].id, 'load-pr-review');
    assert.equal(snapshot.steps[0].status, 'completed');

    // Step 2: failed
    assert.equal(snapshot.steps[1].id, 'evaluate-finalize-gate');
    assert.equal(snapshot.steps[1].status, 'failed');

    // Steps 3, 4, 5: MUST remain pending (not marked failed!)
    assert.equal(snapshot.steps[2].status, 'pending');
    assert.equal(snapshot.steps[3].status, 'pending');
    assert.equal(snapshot.steps[4].status, 'pending');
  });

  await t.test('operation runtime supports reconnect with event replay', () => {
    const runtime = createOperationRuntime();
    const opId = runtime.createOperation({ type: 'verify' });

    runtime.recordEvent(opId, {
      type: 'operation.started',
      steps: [{ id: 'verify-task', label: 'Verify task implementation' }],
    });

    const initialEvents = runtime.getEvents(opId, 0);
    assert.ok(initialEvents.length >= 1);
    const lastId = initialEvents[initialEvents.length - 1].id;

    // Emitting new event while client is disconnected
    runtime.recordEvent(opId, { type: 'operation.step.started', id: 'verify-task' });
    runtime.recordEvent(opId, { type: 'operation.step.completed', id: 'verify-task' });

    // Client reconnects asking for events after lastId
    const reconnectedEvents = runtime.getEvents(opId, lastId);
    assert.equal(reconnectedEvents.length, 2);
    assert.equal(reconnectedEvents[0].type, 'operation.step.started');
    assert.equal(reconnectedEvents[1].type, 'operation.step.completed');
  });

  await t.test('SSE event.id is numeric transport cursor while stepId identifies the business step', () => {
    const runtime = createOperationRuntime();
    const opId = runtime.createOperation({ type: 'approve' });

    runtime.recordEvent(opId, {
      type: 'operation.started',
      steps: [
        { id: 'validate-approval', label: 'Validate approval' },
        { id: 'approve-task', label: 'Approve task' },
      ],
    });

    const emitted = runtime.recordEvent(opId, {
      type: 'operation.step.started',
      stepId: 'approve-task',
      label: 'Approve task',
    });

    // Transport event.id is numeric
    assert.equal(typeof emitted.id, 'number');
    // Step identifier is intact
    assert.equal(emitted.stepId, 'approve-task');

    const snap = runtime.getSnapshot(opId);
    const approveStep = snap.steps.find((s) => s.id === 'approve-task');
    assert.ok(approveStep);
    assert.equal(approveStep.status, 'running');
    // No spurious step with id matching the numeric transport ID was created
    assert.equal(
      snap.steps.find((s) => s.id === String(emitted.id)),
      undefined,
    );
  });
});
