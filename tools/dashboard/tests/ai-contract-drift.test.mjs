import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockAgentProvider } from '../server/ai/providers/mock/provider.mjs';
import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { listen } from '../server/index.mjs';
import { buildAiTestApp } from './helpers/ai-test-app.mjs';
import { ClaudeAgentProvider } from '../server/ai/providers/claude/provider.mjs';
import { CodexAgentProvider } from '../server/ai/providers/codex/provider.mjs';
import { AntigravityAgentProvider } from '../server/ai/providers/antigravity/provider.mjs';
import {
  validateProviderDescriptor,
  validateAgentModelDescriptor,
  AGENT_CAPABILITIES,
  AiValidationError,
} from '../server/ai/contracts.mjs';

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
  const provider = createMockAgentProvider({ specId, taskIds: ['contract-task'] });
  const registry = createAgentProviderRegistry([provider]);
  // Isolated real disk path — never the repo's own `.nevo-ai-local/`, which boot-time
  // reconciliation now actually scans (`listPersistedSessions`).
  const transcriptCache = createTranscriptCacheService({
    baseDir: join(tmpdir(), `nevo-contract-drift-test-${randomUUID()}`),
  });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const aiService = createAgentSessionService({ registry, turnRuntime, transcriptCache });
  const server = await buildAiTestApp({ service: aiService });
  return { server, aiService };
}

// Polls the AI service directly (in-process) — the dashboard's HTTP surface
// has no "get turn by ID alone" endpoint; the canonical, session-correlated
// API doesn't need one, and `aiService` is already right here.
async function waitForTurn(aiService, turnId, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const turn = aiService.getTurn(turnId);
    if (predicate(turn)) return turn;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for AI turn contract state.');
}

async function closeServer(server) {
  server?.server?.closeAllConnections?.();
  server?.closeAllConnections?.();
  await server?.close?.();
}

test('dashboard AI payload field and event names stay aligned with the neutral browser contract', { timeout: 10000 }, async () => {
  const { server, aiService } = await createServer();
  const baseUrl = await listen(server, { port: 0 });

  try {
    const providerPayload = await (await fetch(`${baseUrl}/api/agent-providers`)).json();
    exactKeys(providerPayload, ['providers', 'access']);
    exactKeys(providerPayload.providers[0], [
      'id',
      'label',
      'enabled',
      'available',
      'capabilities',
      'supportedModes',
      'defaultMode',
      'models',
      'health',
    ]);
    exactKeys(providerPayload.providers[0].capabilities, [
      'canOverrideTurnModel',
      'cancelTurn',
      'interactiveConfirmations',
      'interactivePermissions',
      'interactiveQuestions',
      'planUpdates',
      'reasoning',
      'reasoningEvents',
      'resumeSession',
      'steerTurn',
      'toolCalls',
      'usage',
    ]);
    assert.ok(Array.isArray(providerPayload.providers[0].models));
    exactKeys(providerPayload.providers[0].health, ['enabled', 'installed', 'status']);
    assert.deepEqual(providerPayload.providers[0].supportedModes, ['ask', 'edit', 'agent']);
    assert.equal(providerPayload.providers[0].defaultMode, 'edit');

    const sessionPayload = await (await fetch(`${baseUrl}/api/agent-sessions?specId=${specId}`)).json();
    exactKeys(sessionPayload, ['sessions']);

    const permissionStart = await (
      await fetch(
        `${baseUrl}/api/agent-sessions/turns`,
        control({ provider: 'mock', specId, taskId: 'contract-task', message: 'permission contract' }),
      )
    ).json();
    exactKeys(permissionStart, ['turnId', 'providerSessionId', 'idempotent']);
    const permissionTurn = await waitForTurn(aiService, permissionStart.turnId, (turn) => turn.pendingInteraction);
    exactKeys(permissionTurn, [
      'turnId',
      'provider',
      'providerSessionId',
      'status',
      'startedAt',
      'lastEventId',
      'pendingInteraction',
      'events',
    ]);
    exactKeys(permissionTurn.pendingInteraction, ['id', 'kind', 'resumePolicy', 'toolName', 'input', 'details']);
    assert.equal(typeof permissionTurn.events[0].id, 'number');
    assert.equal(typeof permissionTurn.events[0].seq, 'number');
    assert.equal('providerRequestId' in permissionTurn.pendingInteraction, false);

    await fetch(
      `${baseUrl}/api/agent-sessions/mock/${permissionStart.providerSessionId}/interactions/${permissionTurn.pendingInteraction.id}/respond`,
      control({ decision: 'allow' }),
    );
    await waitForTurn(aiService, permissionStart.turnId, (turn) => turn.status === 'completed');

    const questionStart = await (
      await fetch(
        `${baseUrl}/api/agent-sessions/turns`,
        control({ provider: 'mock', specId, taskId: 'contract-task', message: 'question contract' }),
      )
    ).json();
    const questionTurn = await waitForTurn(aiService, questionStart.turnId, (turn) => turn.pendingInteraction);
    exactKeys(questionTurn.pendingInteraction, ['id', 'kind', 'resumePolicy', 'questions']);
    exactKeys(questionTurn.pendingInteraction.questions[0], ['id', 'question', 'header', 'options', 'multiSelect']);
    exactKeys(questionTurn.pendingInteraction.questions[0].options[0], ['label', 'description']);
    assert.ok(questionTurn.pendingInteraction.questions.every((question) => Boolean(question.id)));

    const answers = questionTurn.pendingInteraction.questions.map((question) => ({
      questionId: question.id,
      value: question.multiSelect ? ['Tests'] : 'Focused',
    }));
    await fetch(
      `${baseUrl}/api/agent-sessions/mock/${questionStart.providerSessionId}/interactions/${questionTurn.pendingInteraction.id}/respond`,
      control({ answers }),
    );
    const completed = await waitForTurn(aiService, questionStart.turnId, (turn) => turn.status === 'completed');
    exactKeys(completed, [
      'turnId',
      'provider',
      'providerSessionId',
      'status',
      'startedAt',
      'completedAt',
      'lastEventId',
      'pendingInteraction',
      'events',
    ]);
    assert.ok(completed.events.some((event) => event.type === 'interaction.resolved'));
    assert.ok(completed.events.some((event) => event.type === 'text.delta'));
  } finally {
    await closeServer(server);
  }
});

test('Criterion 3: all adapters conform to updated AgentProviderDescriptor, ProviderCapabilities, and AgentModelDescriptor interfaces', { timeout: 10000 }, () => {
  const cwd = tmpdir();
  const claude = new ClaudeAgentProvider({ cwd });
  const fakeCodexClient = {
    onNotification: () => () => {},
    onServerRequest: () => () => {},
    async listModels() {
      return [];
    },
    async dispose() {},
  };
  const codex = new CodexAgentProvider({ cwd, client: fakeCodexClient });
  const antigravity = new AntigravityAgentProvider({ cwd, ensureMcpRegistered: false });
  const mock = createMockAgentProvider();

  const providers = [claude, codex, antigravity, mock];

  for (const prov of providers) {
    const desc = prov.descriptor;
    assert.ok(desc, `Provider ${desc?.id} must have a descriptor`);

    // Must validate cleanly under validateProviderDescriptor
    const validated = validateProviderDescriptor(desc);
    assert.equal(validated.id, desc.id);
    assert.equal(typeof validated.label, 'string');
    assert.equal(typeof validated.enabled, 'boolean');
    assert.equal(typeof validated.available, 'boolean');

    // Capabilities must define all canonical AGENT_CAPABILITIES
    assert.deepEqual(Object.keys(validated.capabilities).sort(), [...AGENT_CAPABILITIES].sort());
    for (const cap of AGENT_CAPABILITIES) {
      assert.equal(typeof validated.capabilities[cap], 'boolean');
    }

    // Health descriptor
    assert.ok(validated.health);
    assert.equal(typeof validated.health.enabled, 'boolean');
    assert.equal(typeof validated.health.installed, 'boolean');
    assert.ok(['healthy', 'degraded', 'unavailable'].includes(validated.health.status));

    // Supported modes
    assert.ok(Array.isArray(validated.supportedModes));
    assert.ok(validated.supportedModes.length > 0);
    assert.ok(['ask', 'edit', 'agent'].includes(validated.defaultMode));

    // Model catalog
    assert.ok(Array.isArray(validated.models));
    for (const model of validated.models) {
      const validModel = validateAgentModelDescriptor(model);
      assert.equal(validModel.id, model.id);
      assert.ok(['discovered', 'configured', 'known'].includes(validModel.source));
      assert.equal(typeof validModel.traits, 'object');
      assert.equal(typeof validModel.traits.reasoning, 'boolean');
    }
  }

  // Model catalog validation guards against contract drift
  assert.throws(
    () => validateAgentModelDescriptor({ id: '', label: 'Missing ID', source: 'known' }),
    AiValidationError,
  );
  assert.throws(
    () => validateAgentModelDescriptor({ id: 'm1', label: 'Invalid source', source: 'magic' }),
    AiValidationError,
  );
  assert.throws(
    () => validateAgentModelDescriptor({ id: 'm1', label: 'Bad traits', source: 'known', traits: { supportsReasoning: 'yes' } }),
    AiValidationError,
  );
});
