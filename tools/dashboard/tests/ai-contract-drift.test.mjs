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
    const providerPayload = await (await fetch(`${baseUrl}/api/ai/providers`)).json();
    exactKeys(providerPayload, ['providers', 'access']);
    exactKeys(providerPayload.providers[0], ['id', 'label', 'enabled', 'capabilities']);
    exactKeys(providerPayload.providers[0].capabilities, [
      'listSessions', 'sessionMetadata', 'messages', 'createSession', 'startTurn',
      'streamEvents', 'resumeTurn', 'resolveInteractions', 'cancelTurn',
    ]);

    const sessionPayload = await (await fetch(`${baseUrl}/api/ai/sessions?specId=${specId}`)).json();
    exactKeys(sessionPayload, ['sessions']);
    const activeSession = sessionPayload.sessions.find(session => session.status !== 'completed');
    exactKeys(activeSession, [
      'specId', 'provider', 'sessionId', 'taskIds', 'title', 'status',
      'createdAt', 'lastActivityAt', 'capabilities',
    ]);

    const permissionStart = await (await fetch(
      `${baseUrl}/api/ai/sessions/mock/demo-contract-task-1/turns`,
      control({ message: 'permission contract' }),
    )).json();
    exactKeys(permissionStart, ['turnId', 'idempotent']);
    const permissionTurn = await waitForTurn(baseUrl, permissionStart.turnId, turn => turn.pendingInteraction);
    exactKeys(permissionTurn, [
      'turnId', 'provider', 'sessionId', 'status', 'sessionStatus', 'startedAt',
      'lastEventId', 'pendingInteraction', 'events',
    ]);
    exactKeys(permissionTurn.pendingInteraction, ['id', 'kind', 'toolName', 'input', 'details']);
    exactKeys(permissionTurn.events[0], ['id', 'type', 'turnId', 'timestamp']);
    const permissionEvent = permissionTurn.events.find(event => event.type === 'interaction.requested');
    exactKeys(permissionEvent, ['id', 'type', 'turnId', 'timestamp', 'interaction']);
    assert.equal('providerRequestId' in permissionEvent, false);

    await fetch(
      `${baseUrl}/api/ai/turns/${permissionStart.turnId}/interactions/${permissionTurn.pendingInteraction.id}/response`,
      control({ decision: 'allow' }),
    );
    await waitForTurn(baseUrl, permissionStart.turnId, turn => turn.status === 'completed');

    const questionStart = await (await fetch(
      `${baseUrl}/api/ai/sessions/mock/demo-contract-task-2/turns`,
      control({ message: 'question contract' }),
    )).json();
    const questionTurn = await waitForTurn(baseUrl, questionStart.turnId, turn => turn.pendingInteraction);
    exactKeys(questionTurn.pendingInteraction, ['id', 'kind', 'questions']);
    exactKeys(questionTurn.pendingInteraction.questions[0], [
      'id', 'question', 'header', 'options', 'multiSelect',
    ]);
    exactKeys(questionTurn.pendingInteraction.questions[0].options[0], ['label', 'description']);
    assert.ok(questionTurn.pendingInteraction.questions.every(question => question.id.startsWith('question-')));

    const answers = questionTurn.pendingInteraction.questions.map(question => ({
      questionId: question.id,
      value: question.multiSelect ? ['Tests'] : 'Focused',
    }));
    await fetch(
      `${baseUrl}/api/ai/turns/${questionStart.turnId}/interactions/${questionTurn.pendingInteraction.id}/response`,
      control({ answers }),
    );
    const completed = await waitForTurn(baseUrl, questionStart.turnId, turn => turn.status === 'completed');
    exactKeys(completed, [
      'turnId', 'provider', 'sessionId', 'status', 'sessionStatus', 'startedAt',
      'completedAt', 'lastEventId', 'pendingInteraction', 'events',
    ]);
    exactKeys(completed.events.find(event => event.type === 'interaction.resolved'), [
      'id', 'type', 'turnId', 'timestamp', 'interactionId',
    ]);
    exactKeys(completed.events.find(event => event.type === 'message.delta'), [
      'id', 'type', 'turnId', 'timestamp', 'messageId', 'delta',
    ]);
  } finally {
    await closeServer(server);
  }
});
