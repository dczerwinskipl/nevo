import assert from 'node:assert/strict';
import test from 'node:test';

import { createMockAiAdapter } from '../../ai/mock-adapter.mjs';
import { createAiAdapterRegistry } from '../../ai/registry.mjs';
import { createAiSessionService } from '../../ai/service.mjs';
import { createAiTurnRuntime } from '../../ai/turn-runtime.mjs';
import { createDashboardServer, listen } from '../server/index.mjs';

const specId = '70609aaf-bb62-40bf-a25e-bec65c583495';

function exactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function control(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
    body: JSON.stringify(body),
  };
}

function createServer() {
  const adapter = createMockAiAdapter({ specId, taskIds: ['contract-task'] });
  const registry = createAiAdapterRegistry([adapter]);
  const turnRuntime = createAiTurnRuntime({ registry });
  const aiService = createAiSessionService({ registry, turnRuntime });
  return createDashboardServer({
    aiService,
    eventHub: { subscribe: () => () => {}, close: () => {} },
    distDir: 'Z:/does-not-exist',
  });
}

async function waitForTurn(baseUrl, turnId, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/ai/turns/${turnId}`);
    const { turn } = await response.json();
    if (predicate(turn)) return turn;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for AI turn contract state.');
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

test('dashboard AI payload field and event names stay aligned with the neutral browser contract', async () => {
  const server = createServer();
  const baseUrl = await listen(server, { port: 0 });

  try {
    const providerPayload = await (await fetch(`${baseUrl}/api/agent-providers`)).json();
    exactKeys(providerPayload, ['providers', 'access']);
    exactKeys(providerPayload.providers[0], ['id', 'label', 'enabled', 'capabilities']);
    exactKeys(providerPayload.providers[0].capabilities, [
      'cancelTurn', 'interactiveConfirmations', 'interactivePermissions', 'interactiveQuestions',
      'reasoning', 'resumeSession', 'toolCalls', 'usage',
    ]);

    const sessionPayload = await (await fetch(`${baseUrl}/api/agent-sessions?specId=${specId}`)).json();
    exactKeys(sessionPayload, ['sessions']);

    const permissionStart = await (await fetch(
      `${baseUrl}/api/agent-sessions/turns`,
      control({ provider: 'mock', specId, taskId: 'contract-task', message: 'permission contract' }),
    )).json();
    exactKeys(permissionStart, ['turnId', 'providerSessionId', 'idempotent']);
    const permissionTurn = await waitForTurn(baseUrl, permissionStart.turnId, turn => turn.pendingInteraction);
    exactKeys(permissionTurn, [
      'turnId', 'provider', 'providerSessionId', 'status', 'startedAt',
      'lastEventId', 'pendingInteraction', 'events',
    ]);
    exactKeys(permissionTurn.pendingInteraction, ['id', 'kind', 'toolName', 'input', 'details']);
    assert.equal(typeof permissionTurn.events[0].id, 'number');
    assert.equal(typeof permissionTurn.events[0].seq, 'number');
    assert.equal('providerRequestId' in permissionTurn.pendingInteraction, false);

    await fetch(
      `${baseUrl}/api/agent-sessions/mock/${permissionStart.providerSessionId}/interactions/${permissionTurn.pendingInteraction.id}/respond`,
      control({ decision: 'allow' }),
    );
    await waitForTurn(baseUrl, permissionStart.turnId, turn => turn.status === 'completed');

    const questionStart = await (await fetch(
      `${baseUrl}/api/agent-sessions/turns`,
      control({ provider: 'mock', specId, taskId: 'contract-task', message: 'question contract' }),
    )).json();
    const questionTurn = await waitForTurn(baseUrl, questionStart.turnId, turn => turn.pendingInteraction);
    exactKeys(questionTurn.pendingInteraction, ['id', 'kind', 'questions']);
    exactKeys(questionTurn.pendingInteraction.questions[0], [
      'id', 'question', 'header', 'options', 'multiSelect',
    ]);
    exactKeys(questionTurn.pendingInteraction.questions[0].options[0], ['label', 'description']);
    assert.ok(questionTurn.pendingInteraction.questions.every(question => Boolean(question.id)));

    const answers = questionTurn.pendingInteraction.questions.map(question => ({
      questionId: question.id,
      value: question.multiSelect ? ['Tests'] : 'Focused',
    }));
    await fetch(
      `${baseUrl}/api/agent-sessions/mock/${questionStart.providerSessionId}/interactions/${questionTurn.pendingInteraction.id}/respond`,
      control({ answers }),
    );
    const completed = await waitForTurn(baseUrl, questionStart.turnId, turn => turn.status === 'completed');
    exactKeys(completed, [
      'turnId', 'provider', 'providerSessionId', 'status', 'startedAt',
      'completedAt', 'lastEventId', 'pendingInteraction', 'events',
    ]);
    assert.ok(completed.events.some(event => event.type === 'interaction.resolved'));
    assert.ok(completed.events.some(event => event.type === 'text.delta'));
  } finally {
    await closeServer(server);
  }
});
