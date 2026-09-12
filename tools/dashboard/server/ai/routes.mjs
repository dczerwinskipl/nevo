import { resolve } from 'node:path';

import { REPOSITORY_ROOT } from '../infrastructure/paths.mjs';

import { createAgentProviderRegistry } from './providers/registry.mjs';
import { loadAgentProvidersConfig } from './providers/config.mjs';
import { createMockAgentProvider } from './providers/mock/provider.mjs';
import { ClaudeAgentProvider } from './providers/claude/provider.mjs';
import { AntigravityAgentProvider } from './providers/antigravity/provider.mjs';
import { CodexAgentProvider } from './providers/codex/provider.mjs';
import providerRoutes from './providers/routes.mjs';

import { createAgentSessionService } from './sessions/service.mjs';
import { createAgentTurnRuntime } from './sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from './sessions/transcript-cache.mjs';
import { createAgentSessionBindingService } from './sessions/binding-service.mjs';
import sessionRoutes from './sessions/routes.mjs';
import turnRoutes from './sessions/turns/routes.mjs';
import interactionRoutes from './sessions/interactions/routes.mjs';
import aiEventRoutes from './sessions/events/routes.mjs';
import { mcpInteractionRegistry } from './interactions/mcp/index.mjs';

import { createTrustedNetworkAiAccessPolicy } from './access-policy.mjs';
import { aiErrorHandler } from './sessions/http.mjs';

/**
 * Builds the real production Agent session stack for one repository root.
 * `root` (defaulting to `REPOSITORY_ROOT`) is resolved exactly once here and
 * threaded into every provider's cwd/local-data path and into the provider
 * configuration file lookup — the same "resolve once, share everywhere"
 * shape Specs and Pull Requests already use for `config.root` — so a
 * configured/worktree root relocates the whole AI capability together;
 * no provider independently falls back to the real repository root.
 */
export function createDefaultAgentSessionService({
  root = REPOSITORY_ROOT,
  dataLoader,
  providerConfigPath,
  mcpEndpointResolver,
} = {}) {
  const providerConfig = loadAgentProvidersConfig({ repoRoot: root, filePath: providerConfigPath });
  const data = dataLoader ? dataLoader() : {};
  const demonstration =
    data.active?.find(
      (specification) => specification.slug === 'multi-provider-agent-sessions' && specification.specId,
    ) ||
    data.active?.find(
      (specification) => specification.slug === 'ai-sessions-live-chat-integration' && specification.specId,
    ) ||
    data.active?.find((specification) => specification.specId);
  const providers = [];
  for (const providerId of providerConfig.providerOrder) {
    if (!providerConfig.providers[providerId].enabled) continue;
    switch (providerId) {
      case 'claude':
        providers.push(
          new ClaudeAgentProvider({
            cwd: root,
            rawCaptureEnabled: providerConfig.providers.claude?.rawCaptureEnabled,
            rawCaptureDir: providerConfig.providers.claude?.rawCaptureDir,
            mcpEndpointUrl: mcpEndpointResolver,
            configuredModels: providerConfig.providers.claude?.configuredModels,
          }),
        );
        break;
      case 'antigravity':
        providers.push(
          new AntigravityAgentProvider({
            cwd: root,
            mappingFilePath: resolve(root, '.nevo-ai-local', 'antigravity-sessions.json'),
            printTimeoutSeconds: providerConfig.providers.antigravity?.printTimeoutSeconds,
            rawCaptureEnabled: providerConfig.providers.antigravity?.rawCaptureEnabled,
            rawCaptureDir: providerConfig.providers.antigravity?.rawCaptureDir,
            mcpEndpointUrl: mcpEndpointResolver,
          }),
        );
        break;
      case 'codex':
        providers.push(
          new CodexAgentProvider({
            cwd: root,
            rawCaptureEnabled: providerConfig.providers.codex?.rawCaptureEnabled,
            rawCaptureDir: providerConfig.providers.codex?.rawCaptureDir,
          }),
        );
        break;
      case 'mock':
        providers.push(
          createMockAgentProvider(
            demonstration
              ? {
                  specId: demonstration.specId,
                  taskIds: demonstration.tasks?.map((task) => task.id) || [],
                }
              : {},
          ),
        );
        break;
    }
  }
  if (providers.length === 0) {
    console.warn(`[ai] No AI providers are enabled. Configure ${providerConfig.configPath} and restart the dashboard.`);
  }
  const registry = createAgentProviderRegistry(providers);
  const transcriptCache = createTranscriptCacheService({ baseDir: resolve(root, '.nevo-ai-local', 'transcripts') });
  const bindingService = createAgentSessionBindingService({ storageDir: resolve(root, '.nevo-ai-local', 'sessions') });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  return createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService });
}

/**
 * AI/agent-session capability entry point. Constructs the AI service and
 * access policy locally — the application root (app.mjs) never sees
 * Claude/Codex/Antigravity, the provider registry, or the session/turn
 * runtime — and registers one real Fastify route per concern (providers,
 * sessions, turns, interactions, events). `service`/`accessPolicy` are this
 * plugin's own local override options — a feature-level test seam for
 * registering this capability directly on a bare Fastify instance — never
 * routed through `buildDashboardApp()`'s `config`; real usage never passes
 * them, so the real defaults below always apply.
 */
export default async function aiRoutes(
  fastify,
  { config = {}, service: serviceOverride, accessPolicy: accessPolicyOverride } = {},
) {
  const root = config.root ?? REPOSITORY_ROOT;

  const resolveFastifyMcpUrl = () => {
    if (process.env.NEVO_MCP_ENDPOINT_URL) {
      return process.env.NEVO_MCP_ENDPOINT_URL;
    }
    // Primary: explicit local MCP URL injected at startup by startLocalMcpServer().
    // This is always http://127.0.0.1:<ephemeralPort>/mcp — no TLS, no cert needed.
    if (config.localMcpUrl) {
      return config.localMcpUrl;
    }
    // Fallback: derive from the Fastify server address. Used in plain-HTTP test
    // environments and for the Claude provider which has its own configureMcpEndpoint.
    // Correctly uses the actual bound address (not hardcoded 127.0.0.1) so it works
    // when the server is bound to a specific external IP.
    const addr = fastify.server?.address?.();
    if (!addr || typeof addr !== 'object' || !addr.port) {
      return null;
    }
    const protocol = fastify.initialConfig?.https ? 'https' : 'http';
    const bindAddress = addr.address;
    const host =
      !bindAddress || bindAddress === '0.0.0.0' || bindAddress === '::'
        ? '127.0.0.1'
        : bindAddress;
    return `${protocol}://${host}:${addr.port}/mcp`;
  };

  const service = serviceOverride ?? createDefaultAgentSessionService({ root, mcpEndpointResolver: resolveFastifyMcpUrl });
  const claudeProvider = service?.registry?.getProvider?.('claude');
  if (claudeProvider && typeof claudeProvider.configureMcpEndpoint === 'function') {
    claudeProvider.configureMcpEndpoint(resolveFastifyMcpUrl);
  }

  const accessPolicy = accessPolicyOverride ?? createTrustedNetworkAiAccessPolicy();

  let reconciliationPromise = null;
  const ensureReconciled = () => {
    if (!reconciliationPromise) {
      reconciliationPromise = Promise.resolve(service.turnRuntime?.reconcileOrphanedTurns?.()).catch((err) => {
        console.error(`[ai] [reconcile] boot-time turn reconciliation failed: ${err.message}`);
      });
    }
    return reconciliationPromise;
  };

  fastify.addHook('onRequest', async () => {
    await ensureReconciled();
  });

  // AI-domain error *shape* mapping only — JSON parsing itself is inherited
  // from the application-wide parser registered once in app.mjs.
  fastify.setErrorHandler(aiErrorHandler);

  const deps = { service, accessPolicy };
  await fastify.register(providerRoutes, deps);
  await fastify.register(sessionRoutes, deps);
  await fastify.register(turnRoutes, deps);
  await fastify.register(interactionRoutes, deps);
  await fastify.register(aiEventRoutes, deps);
  // mcpRoutes is NOT registered here — MCP is served exclusively on the
  // local-only server started by startLocalMcpServer() in index.mjs.

  // Owned here: this capability constructed (or was given) the AI service
  // and is the only one that knows how to shut it down. mcpInteractionRegistry
  // is a shared singleton regardless of which Fastify instance physically
  // serves its HTTP routes (now the local-only MCP server) — this remains its
  // one owner, so pending MCP interactions are still rejected cleanly instead
  // of hanging when the app closes.
  fastify.addHook('onClose', async () => {
    try {
      mcpInteractionRegistry.shutdown();
      await (service?.shutdown?.() ?? service?.turnRuntime?.shutdown?.());
    } catch (err) {
      console.error('[server] error shutting down AI service:', err);
    }
  });
}
