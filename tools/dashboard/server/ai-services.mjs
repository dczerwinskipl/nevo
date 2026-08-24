import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createMockAiAdapter } from '../../ai/mock-adapter.mjs';
import { ClaudeAgentProvider } from '../../ai/claude-adapter.mjs';
import { AntigravityAgentProvider } from '../../ai/antigravity-adapter.mjs';
import { CodexAgentProvider } from '../../ai/codex-adapter.mjs';
import { createAiAdapterRegistry } from '../../ai/registry.mjs';
import { createAiSessionService } from '../../ai/service.mjs';
import { createAiTurnRuntime } from '../../ai/turn-runtime.mjs';
import { createTranscriptCacheService } from '../../ai/transcript-cache.mjs';
import { createAgentSessionBindingService } from '../../ai/binding-service.mjs';
import { loadAiAdaptersConfig } from './ai-adapters-config.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function createDefaultDashboardAiService({ dataLoader } = {}) {
  const adapterConfig = loadAiAdaptersConfig({ repoRoot: REPO_ROOT });
  const data = dataLoader ? dataLoader() : {};
  const demonstration = data.active?.find(specification => specification.slug === 'multi-provider-agent-sessions' && specification.specId)
    || data.active?.find(specification => specification.slug === 'ai-sessions-live-chat-integration' && specification.specId)
    || data.active?.find(specification => specification.specId);
  const mockAdapter = createMockAiAdapter(demonstration ? {
    specId: demonstration.specId,
    taskIds: demonstration.tasks?.map(task => task.id) || [],
  } : {});
  const claudeAdapter = new ClaudeAgentProvider({ cwd: REPO_ROOT });
  const antigravityAdapter = new AntigravityAgentProvider({
    cwd: REPO_ROOT,
    mappingFilePath: resolve(REPO_ROOT, '.nevo-ai-local', 'antigravity-sessions.json'),
    rawCaptureEnabled: adapterConfig.antigravity.rawCaptureEnabled,
    rawCaptureDir: adapterConfig.antigravity.rawCaptureDir,
  });
  const codexAdapter = new CodexAgentProvider({ cwd: REPO_ROOT });
  const registry = createAiAdapterRegistry([claudeAdapter, antigravityAdapter, codexAdapter, mockAdapter]);
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

