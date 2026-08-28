import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockAiAdapter } from '../../ai/mock-adapter.mjs';
import { createAiAdapterRegistry } from '../../ai/registry.mjs';
import { createAiSessionService } from '../../ai/service.mjs';
import { createAiTurnRuntime } from '../../ai/turn-runtime.mjs';
import { createTranscriptCacheService } from '../../ai/transcript-cache.mjs';
import { buildDashboardApp, listen } from '../server/index.mjs';

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

async function createServer() {
  const adapter = createMockAiAdapter({ specId, taskIds: ['contract-task'] });
  const registry = createAiAdapterRegistry([adapter]);
  // Isolated real disk path — never the repo's own `.nevo-ai-local/`, which boot-time
  // reconciliation now actually scans (`listPersistedSessions`).
  const transcriptCache = createTranscriptCacheService({ baseDir: join(tmpdir(), `nevo-contract-drift-test-${randomUUID()}`) });
  const turnRuntime = createAiTurnRuntime({ registry, transcriptCache });
  const aiService = createAiSessionService({ registry, turnRuntime, transcriptCache });
  const server = await buildDashboardApp({
    config: {
      ai: { service: aiService },
      events: { eventHub: { subscribe: () => () => {}, close: () => {} } },
      distDir: 'Z:/does-not-exist',
    },
  });
  return { server, aiService };
}

// Polls the AI service directly (in-process) — the dashboard's HTTP surface
// has no "get turn by ID alone" endpoint; the canonical, session-correlated
// API doesn't need one, and `aiService` is already right here.
async function waitForTurn(aiService, turnId, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const turn = aiService.getTurn(turnId);
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
  const { server, aiService } = await createServer();
  const baseUrl = await listen(server, { port: 0 });

  try {
    const providerPayload = await (await fetch(`${baseUrl}/api/agent-providers`)).json();
    exactKeys(providerPayload, ['providers', 'access']);
    exactKeys(providerPayload.providers[0], ['id', 'label', 'enabled', 'available', 'capabilities', 'supportedModes', 'defaultMode']);
    exactKeys(providerPayload.providers[0].capabilities, [
      'cancelTurn', 'interactiveConfirmations', 'interactivePermissions', 'interactiveQuestions',
      'planUpdates', 'reasoning', 'resumeSession', 'steerTurn', 'toolCalls', 'usage',
    ]);
    assert.deepEqual(providerPayload.providers[0].supportedModes, ['ask', 'edit', 'agent']);
    assert.equal(providerPayload.providers[0].defaultMode, 'edit');

    const sessionPayload = await (await fetch(`${baseUrl}/api/agent-sessions?specId=${specId}`)).json();
    exactKeys(sessionPayload, ['sessions']);

    const permissionStart = await (await fetch(
      `${baseUrl}/api/agent-sessions/turns`,
      control({ provider: 'mock', specId, taskId: 'contract-task', message: 'permission contract' }),
    )).json();
    exactKeys(permissionStart, ['turnId', 'providerSessionId', 'idempotent']);
    const permissionTurn = await waitForTurn(aiService, permissionStart.turnId, turn => turn.pendingInteraction);
    exactKeys(permissionTurn, [
      'turnId', 'provider', 'providerSessionId', 'status', 'startedAt',
      'lastEventId', 'pendingInteraction', 'events',
    ]);
    exactKeys(permissionTurn.pendingInteraction, ['id', 'kind', 'resumePolicy', 'toolName', 'input', 'details']);
    assert.equal(typeof permissionTurn.events[0].id, 'number');
    assert.equal(typeof permissionTurn.events[0].seq, 'number');
    assert.equal('providerRequestId' in permissionTurn.pendingInteraction, false);

    await fetch(
      `${baseUrl}/api/agent-sessions/mock/${permissionStart.providerSessionId}/interactions/${permissionTurn.pendingInteraction.id}/respond`,
      control({ decision: 'allow' }),
    );
    await waitForTurn(aiService, permissionStart.turnId, turn => turn.status === 'completed');

    const questionStart = await (await fetch(
      `${baseUrl}/api/agent-sessions/turns`,
      control({ provider: 'mock', specId, taskId: 'contract-task', message: 'question contract' }),
    )).json();
    const questionTurn = await waitForTurn(aiService, questionStart.turnId, turn => turn.pendingInteraction);
    exactKeys(questionTurn.pendingInteraction, ['id', 'kind', 'resumePolicy', 'questions']);
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
    const completed = await waitForTurn(aiService, questionStart.turnId, turn => turn.status === 'completed');
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
