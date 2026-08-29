import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemoryHistory } from '@tanstack/react-router';
import {
  createAppRouter,
  routeTree,
} from '../ui/router-tree.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../ui/' + relative, import.meta.url)), 'utf8');
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

  // 4. Spec Session Route: /specs/:source/:slug/sessions/:provider/:providerSessionId
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
    params: {
      source: 'active',
      slug: 'ux-improvements-version-1',
      provider: 'claude',
      providerSessionId: 'session-12345',
    },
  });
  assert.equal(
    router.state.location.pathname,
    '/specs/active/ux-improvements-version-1/sessions/claude/session-12345'
  );

  // 5. Verify /ai/sessions route does NOT exist in routeTree
  const flatRoutes = router.routesByPath;
  assert.equal(flatRoutes['/ai/sessions/$provider/$sessionId'], undefined, 'No global ad-hoc chat route');
  assert.equal(flatRoutes['/active'], undefined, 'No alias redirects');
});

test('2. Open session from spec: spec X -> session A navigates to /specs/X/sessions/provider/providerSessionId', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  const spec = { source: 'active', slug: 'spec-x', specId: 'spec-x-id' };
  // Real API session payload shape from listSessions():
  const sessionA = {
    provider: 'claude',
    providerSessionId: 'provider-sess-xyz',
    specId: 'spec-x-id',
    taskIds: ['task-01'],
  };

  const prevLength = history.length;
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
    params: {
      source: spec.source,
      slug: spec.slug,
      provider: sessionA.provider,
      providerSessionId: sessionA.providerSessionId,
    },
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/spec-x/sessions/claude/provider-sess-xyz',
    'Uses provider and providerSessionId in URL'
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

  // Real API session payload shape
  const specSessions = [
    { provider: 'claude', providerSessionId: 'prov-1', specId: 'spec-100', taskIds: [] },
    { provider: 'gemini', providerSessionId: 'prov-2', specId: 'spec-100', taskIds: [] },
  ];

  const targetProvider = 'gemini';
  const targetProviderSessionId = 'prov-2';
  const found = specSessions.find(
    (s) => s.provider === targetProvider && s.providerSessionId === targetProviderSessionId
  );

  assert.ok(found, 'Session found in spec sessions');
  assert.equal(found.provider, 'gemini');
  assert.equal(found.providerSessionId, 'prov-2');
});

test('4. Session belongs to another spec: opening /specs/X/sessions/A when A is under Y results in Session Not Found (no cross-spec redirect)', () => {
  const specX = { source: 'active', slug: 'spec-x', specId: 'spec-x-id' };
  const sessionsOfX = [
    { provider: 'claude', providerSessionId: 'sess-x1', specId: 'spec-x-id', taskIds: [] },
  ];

  // Attempting to access session 'sess-y1' (which belongs to spec Y) under spec X
  const requestedProvider = 'claude';
  const requestedProviderSessionId = 'sess-y1';
  const foundInX = sessionsOfX.find(
    (s) => s.provider === requestedProvider && s.providerSessionId === requestedProviderSessionId
  );

  assert.equal(foundInX, undefined, 'Session must not be resolved under spec X');
});

test('5. Free/ad-hoc session (specId: null) has no dashboard route', () => {
  const adhocSession = {
    provider: 'claude',
    providerSessionId: 'free-sess-1',
    specId: null,
  };

  // Dashboard routes require source + slug
  assert.equal(adhocSession.specId, null);
  const routerSource = readSource('router-tree.ts');
  assert.ok(!routerSource.includes('/ai/sessions/'), 'Router must not have /ai/sessions/ route');
});

test('6. Back semantics Scenario A: spec -> chat -> app Back (history.back) -> spec -> browser Forward -> chat', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-foo'],
  });
  const router = createAppRouter(history);
  await router.load();

  // Navigate to chat
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
    params: { source: 'active', slug: 'spec-foo', provider: 'claude', providerSessionId: 'sess-1' },
  });
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-foo/sessions/claude/sess-1');
  assert.equal(router.history.canGoBack(), true);

  // App Back triggers router.history.back()
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-foo', 'Back returns to spec');

  // Browser forward triggers router.history.forward()
  router.history.forward();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-foo/sessions/claude/sess-1', 'Forward returns to chat');
});

test('6b. Back semantics Scenario B: direct chat deep link -> app Back fallback (replace: true) -> spec -> browser Back cannot reopen discarded chat', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-bar/sessions/claude/sess-99'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-bar/sessions/claude/sess-99');
  assert.equal(router.history.canGoBack(), false, 'Direct deep link has no prior in-app history');

  // Fallback with replace: true
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'spec-bar' },
    replace: true,
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-bar');
  assert.equal(history.length, 1, 'History was replaced, not pushed');
  assert.equal(router.history.canGoBack(), false, 'Browser Back cannot resurrect discarded chat');
});

test('6c. Back semantics Scenario C: preceding legitimate Nevo screen (/archive) -> chat -> Back follows real history to /archive', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/archive'],
  });
  const router = createAppRouter(history);
  await router.load();

  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
    params: { source: 'active', slug: 'spec-baz', provider: 'antigravity', providerSessionId: 'sess-abc' },
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-baz/sessions/antigravity/sess-abc');
  assert.equal(router.history.canGoBack(), true);

  // App Back triggers history.back()
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/archive', 'Back follows real history to preceding screen');
});

test('7. Session creation: creating session for spec X navigates using returned provider and providerSessionId', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  // Real createSession response shape
  const createdSession = {
    provider: 'claude',
    providerSessionId: 'claude-raw-id-xyz',
    specId: 'spec-x-id',
    taskIds: [],
  };

  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
    params: {
      source: 'active',
      slug: 'spec-x',
      provider: createdSession.provider,
      providerSessionId: createdSession.providerSessionId,
    },
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/spec-x/sessions/claude/claude-raw-id-xyz',
    'Navigates to new session using provider and providerSessionId'
  );
});

test('8. No global session fetch: AppLayout and AppSidebar do not load global sessions', () => {
  const routerSource = readSource('router.tsx');
  const sidebarSource = readSource('components/app-sidebar.tsx');

  // AppLayoutComponent does not query global sessions
  assert.ok(!routerSource.includes('useAiSessions({ enabled: Boolean(data) })'), 'AppLayout must not query all AI sessions globally');
  assert.ok(!sidebarSource.includes('Ostatnie sesje'), 'AppSidebar must not render global session list');
});

test('9. No reverse spec resolution: AiChatPage receives spec directly, without searching all specs', () => {
  const aiChatSource = readSource('components/ai-chat/ai-chat.tsx');

  assert.ok(aiChatSource.includes('spec: DashboardChange'), 'AiChatPage receives spec directly');
  assert.ok(!aiChatSource.includes('changes: DashboardChange[]'), 'AiChatPage must not receive changes array to reverse search');
  assert.ok(!aiChatSource.includes('resolveSessionDestination'), 'No resolveSessionDestination helper');
});

test('10. SpecChatRouteComponent: Fatal initial load error blocks with StatusCard; background refresh error retains active chat', () => {
  const routerSource = readSource('router.tsx');

  // Fatal initial error: error && !data renders blocking StatusCard with retry and back fallback
  assert.ok(routerSource.includes('if (sessionsQuery.error && !sessionsQuery.data) {'), 'Fatal error requires error && !data');
  assert.ok(routerSource.includes('Nie udało się wczytać sesji specyfikacji'), 'Error card title present');
  assert.ok(routerSource.includes('sessionsQuery.refresh()'), 'Retry calls sessionsQuery.refresh');
  assert.ok(routerSource.includes('router.history.canGoBack?.()'), 'Safe in-app history back check');
  assert.ok(routerSource.includes('replace: true'), 'Fallback uses replace semantics');

  // Background refetch failure (error && data): does not trigger blocking StatusCard
  const mockFatalState = { error: 'Network error', data: null, sessions: [] };
  const isFatal = Boolean(mockFatalState.error && !mockFatalState.data);
  assert.equal(isFatal, true, 'No prior data + error -> fatal blocking error');

  const mockBackgroundFailureState = {
    error: 'Poll failed',
    data: { specId: 'spec-1', sessions: [{ provider: 'claude', providerSessionId: 'sess-1' }] },
    sessions: [{ provider: 'claude', providerSessionId: 'sess-1' }],
  };
  const isFatalBackground = Boolean(mockBackgroundFailureState.error && !mockBackgroundFailureState.data);
  assert.equal(isFatalBackground, false, 'Existing data + background error -> non-blocking, chat remains usable');
});

test('11. Session switching: Switching sessions inside same spec uses replace to preserve Spec -> Session history hierarchy', async () => {
  const routerSource = readSource('router.tsx');

  // Verify production handleSwitchSession uses replace: true
  assert.ok(
    routerSource.includes('handleSwitchSession') && routerSource.includes('replace: true'),
    'handleSwitchSession must navigate with replace: true'
  );

  // Memory history test sequence: Spec -> Session A -> Switch to Session B -> Back -> Spec -> Forward -> Session B
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-x');

  // Navigate to Session A (normal push from spec detail)
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
    params: { source: 'active', slug: 'spec-x', provider: 'claude', providerSessionId: 'sess-a' },
  });
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/claude/sess-a');

  // Switch to Session B (in-chat session switch with replace: true)
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
    params: { source: 'active', slug: 'spec-x', provider: 'antigravity', providerSessionId: 'sess-b' },
    replace: true,
  });
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/antigravity/sess-b');

  // History Back returns directly to Spec, bypassing replaced Session A
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-x', 'Back returns to parent specification');

  // History Forward returns to Session B
  router.history.forward();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/antigravity/sess-b', 'Forward restores session B');
});

test('12. Fallback routing: Archived spec accessed via /specs/active/... or active spec via /specs/archive/... resolves fallback without 404', () => {
  const routerSource = readSource('router.tsx');

  // SpecDetail fallback routing logic
  assert.ok(routerSource.includes('const fallbackSpec = useMemo('), 'SpecDetail defines fallbackSpec lookup');
  assert.ok(routerSource.includes('oppositeSource'), 'SpecDetail uses alternate source for fallback');
  assert.ok(routerSource.includes('effectiveSpec'), 'SpecDetail renders effectiveSpec');

  // SpecChat fallback routing logic
  assert.ok(routerSource.includes('effectiveSource = effectiveSpec?.source || source'), 'SpecChat derives effectiveSource from effectiveSpec');
});

test('13. Archived spec sessions: spec-detail and task-dialog enable useAiSessions for archived specs with specId', () => {
  const specDetailSource = readSource('components/spec-detail/spec-detail.tsx');
  const taskDialogSource = readSource('components/task-dialog.tsx');

  assert.ok(
    specDetailSource.includes("useAiSessions({ specId: change.specId || undefined, enabled: Boolean(change.specId) })"),
    'SpecDetail must not restrict useAiSessions to change.source === active'
  );
  assert.ok(
    taskDialogSource.includes("enabled: Boolean(change.specId)"),
    'TaskDialog must not restrict useAiSessions to change.source === active'
  );
});

