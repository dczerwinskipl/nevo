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
 * threaded into every provider's cwd/local-data path, the provider
 * configuration file lookup, and AgentSessionService's own `repoRoot` (which
 * governs deterministic workflow resolution) — the same "resolve once, share
 * everywhere" shape Specs and Pull Requests already use for `config.root` —
 * so a configured/worktree root relocates the whole AI capability together;
 * nothing independently falls back to the real repository root.
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
  return createAgentSessionService({ registry, turnRuntime, transcriptCache, bindingService, repoRoot: root });
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
    // Explicit operator override — an advanced escape hatch, not the normal path.
    // Setting this is the operator's own decision to route MCP traffic somewhere
    // other than the loopback-only local server below (e.g. a remote/shared MCP
    // endpoint). Its semantics: the operator is responsible for that endpoint's
    // reachability from every spawned provider child and, if it is `https://`,
    // for that child's own TLS trust — nothing here injects a certificate for
    // it. This is not a claim that the endpoint is "always local HTTP"; that
    // guarantee applies only to the unoverridden path below.
    if (process.env.NEVO_MCP_ENDPOINT_URL) {
      return process.env.NEVO_MCP_ENDPOINT_URL;
    }
    // Authoritative production endpoint: the loopback-only local MCP server
    // that `buildDashboardRuntime()` starts before this capability is built
    // (see server/index.mjs). Always `http://127.0.0.1:<ephemeralPort>/mcp` —
    // no TLS, no certificate ever needed for it.
    if (config.localMcpUrl) {
      return config.localMcpUrl;
    }
    // Test-only / bare-construction fallback. Reached only when this capability
    // was registered directly (e.g. the `buildAiTestApp` test helper) without
    // going through `buildDashboardRuntime()`, so no local MCP server exists.
    // Real runtime (index.mjs direct-run and scripts/dev.mjs) always supplies
    // `config.localMcpUrl` and never reaches this branch — `/mcp` is not served
    // by the main dashboard Fastify instance in real deployments, so a URL
    // derived from its own address is only meaningful to a test that also
    // registers `mcpRoutes` on this same bare instance.
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
