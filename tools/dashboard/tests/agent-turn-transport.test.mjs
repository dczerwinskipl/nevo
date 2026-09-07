import assert from 'node:assert/strict';
import test from 'node:test';

import {
  postCancelTurn,
  postRespondInteraction,
  postStartTurn,
} from '../ui/features/agent-sessions/runtime/agent-turn-transport.ts';

test('postStartTurn posts message/idempotencyKey/mode and returns the assigned turnId', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ turnId: 'turn-abc' }),
    };
  };

  const result = await postStartTurn('claude', 'sess-1', {
    message: 'Hello',
    idempotencyKey: 'idem-1',
    mode: 'agent',
  });

  assert.deepEqual(result, { turnId: 'turn-abc' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/agent-sessions/claude/sess-1/turns');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-nevo-dashboard-action'], '1');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    message: 'Hello',
    idempotencyKey: 'idem-1',
    mode: 'agent',
  });
});

test('postStartTurn omits mode entirely when not provided (no mode: undefined leaking into the body)', async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal('mode' in body, false);
    return { ok: true, status: 200, json: async () => ({ turnId: 't1' }) };
  };

  await postStartTurn('claude', 'sess-1', { message: 'Hi', idempotencyKey: 'idem-2' });
});

test('postStartTurn throws the server-provided error message on failure', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: { message: 'Turn execution conflict' } }),
  });

  await assert.rejects(
    () => postStartTurn('claude', 'sess-1', { message: 'Hi', idempotencyKey: 'idem-3' }),
    (err) => {
      assert.equal(err.message, 'Turn execution conflict');
      return true;
    },
  );
});

test('postStartTurn falls back to a status-coded message when the error body is unparseable', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => {
      throw new Error('not json');
    },
  });

  await assert.rejects(
    () => postStartTurn('claude', 'sess-1', { message: 'Hi', idempotencyKey: 'idem-4' }),
    (err) => {
      assert.equal(err.message, 'Failed to start turn (500)');
      return true;
    },
  );
});

test('postCancelTurn returns the raw response plus parsed error data on failure, and null error data on success', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/agent-sessions/claude/sess-1/turns/turn-1/cancel');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{}');
    return { ok: false, status: 409, json: async () => ({ error: { message: 'Cannot cancel finished turn' } }) };
  };

  const failed = await postCancelTurn('claude', 'sess-1', 'turn-1');
  assert.equal(failed.response.ok, false);
  assert.equal(failed.response.status, 409);
  assert.deepEqual(failed.errorData, { error: { message: 'Cannot cancel finished turn' } });

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const succeeded = await postCancelTurn('claude', 'sess-1', 'turn-1');
  assert.equal(succeeded.response.ok, true);
  assert.equal(succeeded.errorData, null);
});

test('postRespondInteraction posts the raw response payload and resolves on success', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await postRespondInteraction('claude', 'sess-1', 'int-1', { answer: 'yes' });

  assert.equal(calls[0].url, '/api/agent-sessions/claude/sess-1/interactions/int-1/respond');
  assert.deepEqual(JSON.parse(calls[0].init.body), { answer: 'yes' });
});

test('postRespondInteraction throws the server-provided error message on failure', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: 'Interaction store unavailable' } }),
  });

  await assert.rejects(
    () => postRespondInteraction('claude', 'sess-1', 'int-1', {}),
    (err) => {
      assert.equal(err.message, 'Interaction store unavailable');
      return true;
    },
  );
});
