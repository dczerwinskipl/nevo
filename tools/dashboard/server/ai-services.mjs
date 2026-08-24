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

export function createDefaultDashboardAiService({ dataLoader, adapterConfigPath } = {}) {
  const adapterConfig = loadAiAdaptersConfig({ repoRoot: REPO_ROOT, filePath: adapterConfigPath });
  const data = dataLoader ? dataLoader() : {};
  const demonstration = data.active?.find(specification => specification.slug === 'multi-provider-agent-sessions' && specification.specId)
    || data.active?.find(specification => specification.slug === 'ai-sessions-live-chat-integration' && specification.specId)
    || data.active?.find(specification => specification.specId);
  const adapters = [];
  for (const adapterId of adapterConfig.adapterOrder) {
    if (!adapterConfig.adapters[adapterId].enabled) continue;
    switch (adapterId) {
      case 'claude':
        adapters.push(new ClaudeAgentProvider({ cwd: REPO_ROOT }));
        break;
      case 'antigravity':
        adapters.push(new AntigravityAgentProvider({
          cwd: REPO_ROOT,
          mappingFilePath: resolve(REPO_ROOT, '.nevo-ai-local', 'antigravity-sessions.json'),
          rawCaptureEnabled: adapterConfig.adapters.antigravity.rawCaptureEnabled,
          rawCaptureDir: adapterConfig.adapters.antigravity.rawCaptureDir,
        }));
        break;
      case 'codex':
        adapters.push(new CodexAgentProvider({ cwd: REPO_ROOT }));
        break;
      case 'mock':
        adapters.push(createMockAiAdapter(demonstration ? {
          specId: demonstration.specId,
          taskIds: demonstration.tasks?.map(task => task.id) || [],
        } : {}));
        break;
    }
  }
  if (adapters.length === 0) {
    console.warn(`[ai] No AI adapters are enabled. Configure ${adapterConfig.configPath} and restart the dashboard.`);
  }
  const registry = createAiAdapterRegistry(adapters);
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

