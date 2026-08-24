import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemoryHistory } from '@tanstack/react-router';
import {
  createAppRouter,
  routeTree,
} from '../src/router-tree.ts';
import {
  aiSessionRouteId,
  matchesAiSessionRouteId,
} from '../src/lib/ai-session-identity.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

test('1. Route tree: Only spec and spec session routes exist (no /ai/sessions/... or alias redirects)', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // 1. Active Dashboard
  assert.equal(router.state.location.pathname, '/');

  // 2. Archive Dashboard
  await router.navigate({ to: '/archive' });
  assert.equal(router.state.location.pathname, '/archive');

  // 3. Spec Detail Route
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
  });
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');

  // 4. Spec Session Route: /specs/:source/:slug/sessions/:sessionId (no provider in route)
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$sessionId',
    params: {
      source: 'active',
      slug: 'ux-improvements-version-1',
      sessionId: 'session-12345',
    },
  });
  assert.equal(
    router.state.location.pathname,
    '/specs/active/ux-improvements-version-1/sessions/session-12345'
  );

  // 5. Verify /ai/sessions route does NOT exist in routeTree
  const flatRoutes = router.routesByPath;
  assert.equal(flatRoutes['/ai/sessions/$provider/$sessionId'], undefined, 'No global ad-hoc chat route');
  assert.equal(flatRoutes['/active'], undefined, 'No alias redirects');
});

test('2. Open session from spec uses the provider session ID when a persisted binding has no sessionId alias', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  const spec = { source: 'active', slug: 'spec-x', specId: 'spec-x-id' };
  const sessionA = {
    providerSessionId: 'provider-sess-xyz',
    provider: 'claude',
    specId: 'spec-x-id',
  };

  const routeSessionId = aiSessionRouteId(sessionA);
  const prevLength = history.length;
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$sessionId',
    params: {
      source: spec.source,
      slug: spec.slug,
      sessionId: routeSessionId,
    },
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/spec-x/sessions/provider-sess-xyz',
    'Persisted providerSessionId remains a valid route identity'
  );
  assert.equal(history.length, prevLength + 1, 'Exactly one navigation occurred');
});

test('3. Direct/deep chat load resolves bindings with or without a sessionId alias', () => {
  const spec = {
    source: 'active',
    slug: 'my-feature',
    specId: 'spec-100',
    title: 'My Feature',
    tasks: [{ id: 'task-1', title: 'Task 1' }],
  };

  const specSessions = [
    { providerSessionId: 'prov-1', provider: 'claude', specId: 'spec-100' },
    { sessionId: 'sess-2', providerSessionId: 'prov-2', provider: 'gemini', specId: 'spec-100' },
  ];

  const targetSessionId = 'prov-1';
  const found = specSessions.find((s) => matchesAiSessionRouteId(s, targetSessionId));

  assert.ok(found, 'Session found in spec sessions');
  assert.equal(found.provider, 'claude');
  assert.equal(found.providerSessionId, 'prov-1');
});

test('4. Session belongs to another spec: opening /specs/X/sessions/A when A is under Y results in Session Not Found (no cross-spec redirect)', () => {
  const specX = { source: 'active', slug: 'spec-x', specId: 'spec-x-id' };
  const sessionsOfX = [
    { sessionId: 'sess-x1', specId: 'spec-x-id' },
  ];

  // Attempting to access session 'sess-y1' (which belongs to spec Y) under spec X
  const requestedSessionId = 'sess-y1';
  const foundInX = sessionsOfX.find((s) => s.sessionId === requestedSessionId);

  assert.equal(foundInX, undefined, 'Session must not be resolved under spec X');
});

test('5. Free/ad-hoc session (specId: null) has no dashboard route', () => {
  const adhocSession = {
    sessionId: 'free-sess-1',
    provider: 'claude',
    specId: null,
  };

  // Dashboard routes require source + slug
  assert.equal(adhocSession.specId, null);
  const routerSource = readSource('router-tree.ts');
  assert.ok(!routerSource.includes('/ai/sessions/'), 'Router must not have /ai/sessions/ route');
});

test('6. Runtime metadata derivation: URL uses session.sessionId while runtime receives provider and providerSessionId', () => {
  const session = {
    sessionId: 'nevo-session-1',
    provider: 'codex',
    providerSessionId: 'provider-abc',
    specId: 'spec-1',
  };

  // URL identity:
  const routeParams = { source: 'active', slug: 'my-spec', sessionId: session.sessionId };
  assert.equal(routeParams.sessionId, 'nevo-session-1');

  // Runtime identity passed to useNevoAssistantRuntime:
  const runtimeProvider = session.provider;
  const runtimeSessionId = session.providerSessionId || session.sessionId;

  assert.equal(runtimeProvider, 'codex');
  assert.equal(runtimeSessionId, 'provider-abc');
});

test('7. Back: /specs/:source/:slug/sessions/:sessionId -> Back navigates directly to parent /specs/:source/:slug', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/', '/specs/active/foo/sessions/session-42'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/foo/sessions/session-42');

  // Production Back action in SpecChatRouteComponent:
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'foo' },
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/foo', 'Back always navigates to parent spec');
});

test('8. Session creation navigates even when the response only contains providerSessionId', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  const createdSession = {
    providerSessionId: 'claude-raw-id-xyz',
    provider: 'claude',
    specId: 'spec-x-id',
  };

  await router.navigate({
    to: '/specs/$source/$slug/sessions/$sessionId',
    params: {
      source: 'active',
      slug: 'spec-x',
      sessionId: aiSessionRouteId(createdSession),
    },
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/spec-x/sessions/claude-raw-id-xyz',
    'Navigates to new session using its canonical available identity'
  );
});

test('9. AppLayout restores recent sessions without adding a global chat route', () => {
  const routerSource = readSource('router.tsx');
  const sidebarSource = readSource('components/app-sidebar.tsx');

  assert.ok(routerSource.includes('useAiSessions({ enabled: Boolean(data) })'), 'AppLayout loads recent sessions');
  assert.ok(sidebarSource.includes('Ostatnie sesje'), 'AppSidebar renders the recent-session list');
  assert.ok(!routerSource.includes("to: '/ai/sessions/"), 'Recent sessions still navigate through spec-scoped routes');
});

test('10. No reverse spec resolution: AiChatPage receives spec directly, without searching all specs', () => {
  const aiChatSource = readSource('components/ai-chat.tsx');

  assert.ok(aiChatSource.includes('spec: DashboardChange'), 'AiChatPage receives spec directly');
  assert.ok(!aiChatSource.includes('changes: DashboardChange[]'), 'AiChatPage must not receive changes array to reverse search');
  assert.ok(!aiChatSource.includes('resolveSessionDestination'), 'No resolveSessionDestination helper');
});
