import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROGRESS_PREFIX,
  PROGRESS_EVENT_TYPES,
  formatProgressEvent,
  parseProgressLine,
  createProgressEmitter,
} from '../lib/operation-progress.mjs';

test('operation-progress — format and parse progress events', async (t) => {
  await t.test('formatProgressEvent prefixes line with standard framing and adds timestamp', () => {
    const formatted = formatProgressEvent('operation.started', { operationType: 'verify' }, () => new Date('2026-08-16T12:00:00Z'));
    assert.equal(formatted.startsWith(PROGRESS_PREFIX), true);
    assert.equal(formatted.endsWith('\n'), true);

    const parsed = parseProgressLine(formatted);
    assert.deepEqual(parsed, {
      type: 'operation.started',
      timestamp: '2026-08-16T12:00:00.000Z',
      operationType: 'verify',
    });
  });

  await t.test('parseProgressLine returns null for non-progress lines or corrupted JSON', () => {
    assert.equal(parseProgressLine('plain log output'), null);
    assert.equal(parseProgressLine('{"status":"ok"}'), null);
    assert.equal(parseProgressLine(`${PROGRESS_PREFIX}not-json`), null);
    assert.equal(parseProgressLine(null), null);
    assert.equal(parseProgressLine(undefined), null);
  });

  await t.test('createProgressEmitter writes all event types to output stream with correct schema', () => {
    const lines = [];
    const out = {
      write(chunk) {
        lines.push(chunk);
      },
    };
    const emitter = createProgressEmitter({
      out,
      clock: () => new Date('2026-08-16T12:00:00Z'),
    });

    emitter.operationStarted({ type: 'task-verification', totalSteps: 3, steps: [{ id: 's1', label: 'Step 1' }] });
    emitter.stepStarted({ id: 's1', label: 'Step 1', total: 10 });
    emitter.stepProgress({ id: 's1', current: 5, total: 10, detail: 'halfway' });
    emitter.stepCompleted({ id: 's1', detail: 'done' });
    emitter.stepFailed({ id: 's2', error: new Error('boom'), detail: 'failed command' });
    emitter.operationCompleted({ result: { ok: true } });
    emitter.operationFailed({ error: 'fatal' });

    assert.equal(lines.length, 7);

    const events = lines.map(line => parseProgressLine(line));
    assert.equal(events[0].type, 'operation.started');
    assert.equal(events[0].operationType, 'task-verification');
    assert.equal(events[0].totalSteps, 3);
    assert.deepEqual(events[0].steps, [{ id: 's1', label: 'Step 1' }]);

    assert.equal(events[1].type, 'operation.step.started');
    assert.equal(events[1].id, 's1');
    assert.equal(events[1].total, 10);

    assert.equal(events[2].type, 'operation.step.progress');
    assert.equal(events[2].id, 's1');
    assert.equal(events[2].current, 5);

    assert.equal(events[3].type, 'operation.step.completed');
    assert.equal(events[3].id, 's1');

    assert.equal(events[4].type, 'operation.step.failed');
    assert.equal(events[4].id, 's2');
    assert.equal(events[4].error.message, 'boom');

    assert.equal(events[5].type, 'operation.completed');
    assert.deepEqual(events[5].result, { ok: true });

    assert.equal(events[6].type, 'operation.failed');
    assert.equal(events[6].error.message, 'fatal');
  });
});
