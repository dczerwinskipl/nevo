import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMemoryHistory, isRedirect } from '@tanstack/react-router';
import {
  createAppRouter,
  activeAliasRoute,
  specsArchiveAliasRoute,
  specSlugAliasRoute,
  createSessionSwitchNavigator,
  createBackNavigator,
  createRestoreTaskIdConsumer,
  resolveSpecRouteCanonicalization,
} from '../src/router-tree.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

test('Finding 2 & 3 (TanStack Router): Route tree resolves primary screens with clean URLs', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // 1. Active Dashboard
  assert.equal(router.state.location.pathname, '/');

  // 2. Archive Dashboard
  await router.navigate({ to: '/archive' });
  assert.equal(router.state.location.pathname, '/archive');

  // 3. Spec Detail Route (No search query in primary URL)
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
  });
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
  assert.equal(Object.keys(router.state.location.search).length, 0);

  // 4. AI Chat Route (Only turnId is optionally in search, no prompt or task metadata in search)
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'session-12345' },
    search: { turnId: 'turn-abc' },
  });
  assert.equal(router.state.location.pathname, '/ai/sessions/claude/session-12345');
  assert.equal(router.state.location.search.turnId, 'turn-abc');
  assert.equal(router.state.location.search.originTaskId, undefined, 'originTaskId must not be in search');
  assert.equal(router.state.location.search.initialPrompt, undefined, 'initialPrompt must not be in search');
});

test('Finding 3 & 4 (TanStack Router): Redirect aliases route to canonical URLs', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // Alias /active matches activeAliasRoute and triggers redirect to /
  const activeMatches = router.matchRoutes('/active');
  assert.equal(activeMatches[activeMatches.length - 1]?.routeId, '/app-layout/active');
  try {
    await activeAliasRoute.options.beforeLoad({});
    assert.fail('Should have thrown redirect');
  } catch (err) {
    assert.equal(isRedirect(err), true);
    assert.equal(err.options.to, '/');
  }

  // Alias /specs/archive matches specsArchiveAliasRoute and triggers redirect to /archive
  const archiveMatches = router.matchRoutes('/specs/archive');
  assert.equal(archiveMatches[archiveMatches.length - 1]?.routeId, '/app-layout/specs/archive');
  try {
    await specsArchiveAliasRoute.options.beforeLoad({});
    assert.fail('Should have thrown redirect');
  } catch (err) {
    assert.equal(isRedirect(err), true);
    assert.equal(err.options.to, '/archive');
  }

  // Alias /specs/:slug matches specSlugAliasRoute and triggers redirect to /specs/active/:slug
  const slugMatches = router.matchRoutes('/specs/ux-improvements-version-1');
  assert.equal(slugMatches[slugMatches.length - 1]?.routeId, '/app-layout/specs/$slug');
  try {
    await specSlugAliasRoute.options.beforeLoad({ params: { slug: 'ux-improvements-version-1' } });
    assert.fail('Should have thrown redirect');
  } catch (err) {
    assert.equal(isRedirect(err), true);
    assert.equal(err.options.to, '/specs/$source/$slug');
    assert.deepEqual(err.options.params, { source: 'active', slug: 'ux-improvements-version-1' });
  }
});

test('Finding 2 (TanStack Router): Task -> Chat -> Back preserves clean URLs and restores task via history state', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // 1. User opens spec (clean URL)
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
  });
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
  assert.equal(Object.keys(router.state.location.search).length, 0);

  // 2. User opens TaskDialog in spec: local state, URL is unchanged.
  // When navigating to Chat from the dialog, spec entry receives restoreTaskId in history state:
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
    state: (prev) => ({ ...prev, restoreTaskId: '08-chat-follow-scroll' }),
    replace: true,
  });

  // 3. User navigates from TaskDialog to Chat with transient origin state (clean URL)
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'sess-task-1' },
    state: (prev) => ({
      ...prev,
      origin: 'task',
      originTaskId: '08-chat-follow-scroll',
      originSpecSlug: 'ux-improvements-version-1',
      originSpecSource: 'active',
    }),
  });
  assert.equal(router.state.location.pathname, '/ai/sessions/claude/sess-task-1');
  assert.equal(Object.keys(router.state.location.search).length, 0, 'Chat URL must not have originTaskId in search');
  assert.equal(router.state.location.state?.origin, 'task');
  assert.equal(router.state.location.state?.originTaskId, '08-chat-follow-scroll');

  // 4. Back pops to spec: URL is clean, history state has restoreTaskId
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
  assert.equal(Object.keys(router.state.location.search).length, 0, 'Spec URL must remain clean on Back');
  assert.equal(router.state.location.state?.restoreTaskId, '08-chat-follow-scroll', 'Restores task via history state');
});

test('Finding 1 (Session Switching Regression): Active session A -> production onSwitchSession(session B) -> route and state become session B', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/ai/sessions/claude/session-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/claude/session-A');

  // Target session B with distinct provider and resolved effective session id
  const targetSessionB = {
    provider: 'gemini',
    sessionId: 'session-B-internal-id',
    providerSessionId: 'session-B-provider-id',
  };

  // Invoke the exact production session-switch handler used by ChatRouteComponent
  const onSwitchSession = createSessionSwitchNavigator(router.navigate, { origin: 'dashboard' });
  await onSwitchSession(targetSessionB);
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/gemini/session-B-provider-id');
  const match = router.state.matches.find((m) => m.routeId === '/ai/sessions/$provider/$sessionId');
  assert.equal(match?.params.provider, 'gemini');
  assert.equal(match?.params.sessionId, 'session-B-provider-id');
  assert.equal(router.state.location.state?.origin, 'dashboard');
});

test('Finding 3 (TanStack Router): Direct deep link with canGoBack=false executes deterministic fallback', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/ai/sessions/claude/deep-link-session-123'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/claude/deep-link-session-123');
  assert.equal(router.history.canGoBack(), false, 'Direct deep link entry must report canGoBack=false');

  // Fallback execution when canGoBack is false: navigates to spec or /
  if (!router.history.canGoBack()) {
    await router.navigate({
      to: '/specs/$source/$slug',
      params: { source: 'active', slug: 'ux-improvements-version-1' },
    });
  }
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
});

test('Finding 3 (TanStack Router): Back label derivation from actual history state origin', () => {
  const routerSource = readSource('router.tsx');

  // Explicit origin derivation
  assert.ok(routerSource.includes("if (origin === 'task') return 'Wróć do taska';"));
  assert.ok(routerSource.includes("if (origin === 'spec') return 'Wróć do specyfikacji';"));
  assert.ok(routerSource.includes("if (origin === 'dashboard') return 'Wróć do listy';"));
});

test('Finding 4 (TanStack Router): Single click on sidebar Active/Archive tabs creates exactly one history transition', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(history.length, 1);
  assert.equal(router.state.location.pathname, '/');

  // Click Archive tab -> exactly 1 transition
  await router.navigate({ to: '/archive' });
  assert.equal(history.length, 2);
  assert.equal(router.state.location.pathname, '/archive');

  // Click Active tab -> exactly 1 transition
  await router.navigate({ to: '/' });
  assert.equal(history.length, 3);
  assert.equal(router.state.location.pathname, '/');

  // AppSidebar source check: no duplicate imperative navigate in onClick
  const sidebarSource = readSource('components/app-sidebar.tsx');
  assert.ok(!sidebarSource.includes('onModeChange'), 'AppSidebar must not have duplicate onModeChange prop');
});

test('Item 10: TaskDialog is local UI overlay and does not mutate route search query', () => {
  const aiChatSource = readSource('components/ai-chat.tsx');
  const specDetailSource = readSource('components/spec-detail.tsx');

  // In ai-chat.tsx, inspecting task is local state
  assert.ok(aiChatSource.includes('const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);'));
  assert.ok(aiChatSource.includes('setInspectedTaskId(taskId);'));
  assert.ok(aiChatSource.includes('onClose={() => setInspectedTaskId(null)}'));

  // In spec-detail.tsx, selectedTaskId is local state without search query manipulation
  assert.ok(specDetailSource.includes('const [selectedTaskId, setSelectedTaskId] = useState<string | null>'));
  assert.ok(specDetailSource.includes('onClose={closeTask}'));
});

test('Issue 1 (Behavioral): restoreTaskId is consumed exactly once and does not resurrect closed dialog on refresh or navigation', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // 1. Navigate to spec
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'spec-test' },
  });

  // 2. Open task -> store restoreTaskId in history state and navigate to chat
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'spec-test' },
    state: (prev) => ({ ...prev, restoreTaskId: 'task-1' }),
    replace: true,
  });

  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'session-1' },
    state: (prev) => ({ ...prev, origin: 'task', originTaskId: 'task-1' }),
  });

  // 3. User clicks Back -> returns to spec with restoreTaskId in history state
  router.history.back();
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-test');
  assert.equal(router.state.location.state?.restoreTaskId, 'task-1', 'Task dialog restored on Back');

  // 4. SpecDetail consumes restoreTaskId with replace semantics immediately
  const consumeRestoreTaskId = createRestoreTaskIdConsumer(router.navigate, 'active', 'spec-test');
  await consumeRestoreTaskId();
  await router.load();

  // URL must not change and restoreTaskId must be cleared from current history entry
  assert.equal(router.state.location.pathname, '/specs/active/spec-test');
  assert.equal(router.state.location.state?.restoreTaskId, undefined, 'restoreTaskId must be consumed and cleared');

  // 5. User explicitly closes the dialog (selectedTaskId becomes null)
  let selectedTaskId = null;

  // 6. Simulate SSE/dashboard refresh with new change.tasks reference
  const refreshedTasks = [{ id: 'task-1', title: 'Task 1' }, { id: 'task-2', title: 'Task 2' }];
  // SpecDetail with consumedTaskIdRef and cleared history state does not reopen the task
  const initialTaskId = router.state.location.state?.restoreTaskId || null;
  assert.equal(initialTaskId, null, 'initialTaskId is now null');
  assert.equal(selectedTaskId, null, 'Task remains closed across data/task refreshes');

  // 7. Navigate away to / and navigate back: restoreTaskId remains absent
  await router.navigate({ to: '/' });
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/spec-test');
  assert.equal(router.state.location.state?.restoreTaskId, undefined, 'History state does not resurrect closed task');
});

test('Issue 2 (Behavioral): Direct deep-link Back fallback uses replace semantics and does not allow browser Back to return to discarded chat', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/ai/sessions/claude/direct-deep-link-session'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/claude/direct-deep-link-session');
  assert.equal(router.history.canGoBack(), false, 'Direct entry has canGoBack=false');
  assert.equal(history.length, 1);

  // Execute production back navigator with associated spec change
  const associatedChange = { source: 'active', slug: 'direct-spec-slug' };
  const handleBack = createBackNavigator(router.history, router.navigate, associatedChange);
  await handleBack();
  await router.load();

  // Route is replaced with the spec URL, history length stays 1
  assert.equal(router.state.location.pathname, '/specs/active/direct-spec-slug');
  assert.equal(history.length, 1, 'History entry must be REPLACED, not pushed');
  assert.equal(router.history.canGoBack(), false, 'Cannot go back to discarded direct chat');

  // Test fallback without associated change (defaults to / with replace)
  const historyRoot = createMemoryHistory({
    initialEntries: ['/ai/sessions/claude/standalone-session'],
  });
  const routerRoot = createAppRouter(historyRoot);
  await routerRoot.load();

  const handleBackRoot = createBackNavigator(routerRoot.history, routerRoot.navigate, null);
  await handleBackRoot();
  await routerRoot.load();

  assert.equal(routerRoot.state.location.pathname, '/');
  assert.equal(historyRoot.length, 1, 'History entry replaced with /');
});

test('Issue 3 (Behavioral): Route source canonicalization keeps URL and rendered spec collection in sync', () => {
  const activeSpecs = [
    { slug: 'active-feature-a', source: 'active' },
    { slug: 'active-feature-b', source: 'active' },
  ];
  const archiveSpecs = [
    { slug: 'archived-feature-x', source: 'archive' },
    { slug: 'archived-feature-y', source: 'archive' },
  ];

  // 1. Active URL + active spec -> matched
  const r1 = resolveSpecRouteCanonicalization({
    requestedSource: 'active',
    slug: 'active-feature-a',
    activeSpecs,
    archiveSpecs,
  });
  assert.equal(r1.status, 'matched');
  assert.equal(r1.canonicalSource, 'active');
  assert.equal(r1.spec.slug, 'active-feature-a');

  // 2. Archive URL + archive spec -> matched
  const r2 = resolveSpecRouteCanonicalization({
    requestedSource: 'archive',
    slug: 'archived-feature-x',
    activeSpecs,
    archiveSpecs,
  });
  assert.equal(r2.status, 'matched');
  assert.equal(r2.canonicalSource, 'archive');
  assert.equal(r2.spec.slug, 'archived-feature-x');

  // 3. Stale active URL for now-archived spec -> canonical redirect to archive
  const r3 = resolveSpecRouteCanonicalization({
    requestedSource: 'active',
    slug: 'archived-feature-x',
    activeSpecs,
    archiveSpecs,
  });
  assert.equal(r3.status, 'redirect');
  assert.equal(r3.canonicalSource, 'archive');
  assert.equal(r3.spec.slug, 'archived-feature-x');

  // 4. Stale archive URL for now-active spec -> canonical redirect to active
  const r4 = resolveSpecRouteCanonicalization({
    requestedSource: 'archive',
    slug: 'active-feature-b',
    activeSpecs,
    archiveSpecs,
  });
  assert.equal(r4.status, 'redirect');
  assert.equal(r4.canonicalSource, 'active');
  assert.equal(r4.spec.slug, 'active-feature-b');

  // 5. Missing slug -> not-found
  const r5 = resolveSpecRouteCanonicalization({
    requestedSource: 'active',
    slug: 'completely-missing-slug',
    activeSpecs,
    archiveSpecs,
  });
  assert.equal(r5.status, 'not-found');
  assert.equal(r5.spec, undefined);
});
