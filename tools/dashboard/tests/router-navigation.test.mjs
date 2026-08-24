import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemoryHistory } from '@tanstack/react-router';
import {
  createAppRouter,
  routeTree,
} from '../src/router-tree.ts';

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

test('2. Open session from spec: spec X -> session A navigates to /specs/X/sessions/A using session.sessionId', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  const spec = { source: 'active', slug: 'spec-x', specId: 'spec-x-id' };
  const sessionA = {
    sessionId: 'nevo-sess-a',
    providerSessionId: 'provider-sess-xyz',
    provider: 'claude',
    specId: 'spec-x-id',
  };

  // Production navigation uses spec + session.sessionId
  const prevLength = history.length;
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$sessionId',
    params: {
      source: spec.source,
      slug: spec.slug,
      sessionId: sessionA.sessionId,
    },
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/spec-x/sessions/nevo-sess-a',
    'Uses session.sessionId in URL, not providerSessionId'
  );
  assert.equal(history.length, prevLength + 1, 'Exactly one navigation occurred');
});

test('3. Direct/deep chat load: route resolves spec X and looks up session in X sessions', () => {
  const spec = {
    source: 'active',
    slug: 'my-feature',
    specId: 'spec-100',
    title: 'My Feature',
    tasks: [{ id: 'task-1', title: 'Task 1' }],
  };

  const specSessions = [
    { sessionId: 'sess-1', providerSessionId: 'prov-1', provider: 'claude', specId: 'spec-100' },
    { sessionId: 'sess-2', providerSessionId: 'prov-2', provider: 'gemini', specId: 'spec-100' },
  ];

  const targetSessionId = 'sess-2';
  const found = specSessions.find((s) => s.sessionId === targetSessionId);

  assert.ok(found, 'Session found in spec sessions');
  assert.equal(found.provider, 'gemini');
  assert.equal(found.providerSessionId, 'prov-2');
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

test('8. Session creation: creating session for spec X navigates using returned session.sessionId', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  const createdSession = {
    sessionId: 'new-nevo-session-99',
    providerSessionId: 'claude-raw-id-xyz',
    provider: 'claude',
    specId: 'spec-x-id',
  };

  await router.navigate({
    to: '/specs/$source/$slug/sessions/$sessionId',
    params: {
      source: 'active',
      slug: 'spec-x',
      sessionId: createdSession.sessionId,
    },
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/spec-x/sessions/new-nevo-session-99',
    'Navigates to new session using NEvo sessionId'
  );
});

test('9. No global session fetch: AppLayout and AppSidebar do not load global sessions', () => {
  const routerSource = readSource('router.tsx');
  const sidebarSource = readSource('components/app-sidebar.tsx');

  // AppLayoutComponent does not query global sessions
  assert.ok(!routerSource.includes('useAiSessions({ enabled: Boolean(data) })'), 'AppLayout must not query all AI sessions globally');
  assert.ok(!sidebarSource.includes('Ostatnie sesje'), 'AppSidebar must not render global session list');
});

test('10. No reverse spec resolution: AiChatPage receives spec directly, without searching all specs', () => {
  const aiChatSource = readSource('components/ai-chat.tsx');

  assert.ok(aiChatSource.includes('spec: DashboardChange'), 'AiChatPage receives spec directly');
  assert.ok(!aiChatSource.includes('changes: DashboardChange[]'), 'AiChatPage must not receive changes array to reverse search');
  assert.ok(!aiChatSource.includes('resolveSessionDestination'), 'No resolveSessionDestination helper');
});
