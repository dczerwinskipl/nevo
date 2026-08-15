import { createMockAiAdapter } from '../../ai/mock-adapter.mjs';
import { createAiAdapterRegistry } from '../../ai/registry.mjs';
import { createAiSessionService } from '../../ai/service.mjs';
import { createAiTurnRuntime } from '../../ai/turn-runtime.mjs';

export function createDefaultDashboardAiService({ dataLoader } = {}) {
  const data = dataLoader();
  const demonstration = data.active?.find(specification => specification.slug === 'ai-sessions-live-chat-integration' && specification.specId)
    || data.active?.find(specification => specification.specId);
  const adapter = createMockAiAdapter(demonstration ? {
    specId: demonstration.specId,
    taskIds: demonstration.tasks?.map(task => task.id) || [],
  } : {});
  const registry = createAiAdapterRegistry([adapter]);
  const turnRuntime = createAiTurnRuntime({ registry });
  return createAiSessionService({ registry, turnRuntime });
}

export function createTrustedNetworkAiAccessPolicy() {
  return ({ capability }) => {
    if (capability !== 'read' && capability !== 'control') return false;
    return true;
  };
}
