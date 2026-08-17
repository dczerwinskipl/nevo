import { createMockAiAdapter } from '../../ai/mock-adapter.mjs';
import { ClaudeAgentProvider } from '../../ai/claude-adapter.mjs';
import { createAiAdapterRegistry } from '../../ai/registry.mjs';
import { createAiSessionService } from '../../ai/service.mjs';
import { createAiTurnRuntime } from '../../ai/turn-runtime.mjs';
import { createTranscriptCacheService } from '../../ai/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../../ai/binding-service.mjs';

export function createDefaultDashboardAiService({ dataLoader } = {}) {
  const data = dataLoader ? dataLoader() : {};
  const demonstration = data.active?.find(specification => specification.slug === 'multi-provider-agent-sessions' && specification.specId)
    || data.active?.find(specification => specification.slug === 'ai-sessions-live-chat-integration' && specification.specId)
    || data.active?.find(specification => specification.specId);
  const mockAdapter = createMockAiAdapter(demonstration ? {
    specId: demonstration.specId,
    taskIds: demonstration.tasks?.map(task => task.id) || [],
  } : {});
  const claudeAdapter = new ClaudeAgentProvider();
  const registry = createAiAdapterRegistry([mockAdapter, claudeAdapter]);
  const transcriptCache = createTranscriptCacheService();
  const bindingService = createAgentSessionBindingService();
  const turnRuntime = createAiTurnRuntime({ registry, transcriptCache });
  return createAiSessionService({ registry, turnRuntime, transcriptCache, bindingService });
}

export function createTrustedNetworkAiAccessPolicy() {
  return ({ capability }) => {
    if (capability !== 'read' && capability !== 'control') return false;
    return true;
  };
}

