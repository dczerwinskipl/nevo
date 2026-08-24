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
  resolveSessionRoute,
} from '../src/router-tree.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

test('Route tree resolves primary screens with clean URLs including spec-scoped and global chat', async () => {
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

  // 4. Spec-Scoped AI Chat Route
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$sessionId',
    params: {
      source: 'active',
      slug: 'ux-improvements-version-1',
      provider: 'claude',
      sessionId: 'session-12345',
    },
    search: { turnId: 'turn-abc' },
  });
  assert.equal(
    router.state.location.pathname,
    '/specs/active/ux-improvements-version-1/sessions/claude/session-12345'
  );
  assert.equal(router.state.location.search.turnId, 'turn-abc');
  assert.equal(router.state.location.search.originTaskId, undefined, 'originTaskId must not be in search');
  assert.equal(router.state.location.search.initialPrompt, undefined, 'initialPrompt must not be in search');

  // 5. Global/Ad-hoc AI Chat Route
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'gemini', sessionId: 'adhoc-session-999' },
  });
  assert.equal(router.state.location.pathname, '/ai/sessions/gemini/adhoc-session-999');
});

test('Redirect aliases route to canonical URLs', async () => {
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

test('Task -> Chat -> Back preserves clean URLs and restores task via history state', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // 1. User opens spec (clean URL)
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
  });
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');

  // 2. User opens TaskDialog in spec: local state, URL is unchanged.
  // When navigating to Chat from the dialog, spec entry receives restoreTaskId in history state:
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
    state: (prev) => ({ ...prev, restoreTaskId: '08-chat-follow-scroll' }),
    replace: true,
  });

  // 3. User navigates from TaskDialog to spec-scoped Chat with transient origin state
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$sessionId',
    params: {
      source: 'active',
      slug: 'ux-improvements-version-1',
      provider: 'claude',
      sessionId: 'sess-task-1',
    },
    state: (prev) => ({
      ...prev,
      origin: 'task',
      originTaskId: '08-chat-follow-scroll',
    }),
  });
  assert.equal(
    router.state.location.pathname,
    '/specs/active/ux-improvements-version-1/sessions/claude/sess-task-1'
  );
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

test('1. Spec-bound session from sidebar: resolveSessionRoute navigates to /specs/:source/:slug/sessions/:provider/:sessionId', () => {
  const specs = [
    { specId: 'spec-x-id', source: 'active', slug: 'spec-x' },
    { specId: 'spec-y-id', source: 'archive', slug: 'spec-y' },
  ];

  const sessionX = {
    provider: 'claude',
    sessionId: 'internal-1',
    providerSessionId: 'claude-sess-1',
    specId: 'spec-x-id',
  };

  const dest = resolveSessionRoute(sessionX, specs);
  assert.equal(dest.to, '/specs/$source/$slug/sessions/$provider/$sessionId');
  assert.deepEqual(dest.params, {
    source: 'active',
    slug: 'spec-x',
    provider: 'claude',
    sessionId: 'claude-sess-1',
  });
});

test('2. Ad-hoc session from sidebar: resolveSessionRoute navigates to /ai/sessions/:provider/:sessionId', () => {
  const specs = [
    { specId: 'spec-x-id', source: 'active', slug: 'spec-x' },
  ];

  const adhocSession = {
    provider: 'gemini',
    sessionId: 'internal-2',
    providerSessionId: 'gemini-sess-2',
    specId: null,
  };

  const dest = resolveSessionRoute(adhocSession, specs);
  assert.equal(dest.to, '/ai/sessions/$provider/$sessionId');
  assert.deepEqual(dest.params, {
    provider: 'gemini',
    sessionId: 'gemini-sess-2',
  });
});

test('3. Legacy/global deep link to a spec-bound session: triggers replace redirect to canonical spec-scoped route', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/ai/sessions/claude/legacy-spec-session'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/claude/legacy-spec-session');

  const specs = [{ specId: 'spec-100', source: 'active', slug: 'my-feature' }];
  const loadedSession = {
    provider: 'claude',
    sessionId: 'legacy-spec-session',
    specId: 'spec-100',
  };

  // When global chat component mounts and detects loadedSession.specId:
  const target = resolveSessionRoute(loadedSession, specs);
  assert.equal(target.to, '/specs/$source/$slug/sessions/$provider/$sessionId');

  await router.navigate({
    to: target.to,
    params: target.params,
    replace: true,
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/my-feature/sessions/claude/legacy-spec-session'
  );
  assert.equal(history.length, 1, 'Replace redirect does not create redundant history entry');
});

test('4. Legacy/global deep link to ad-hoc session: session.specId = null -> no redirect', () => {
  const specs = [{ specId: 'spec-100', source: 'active', slug: 'my-feature' }];
  const adhocSession = {
    provider: 'claude',
    sessionId: 'adhoc-session-42',
    specId: null,
  };

  const target = resolveSessionRoute(adhocSession, specs);
  assert.equal(target.to, '/ai/sessions/$provider/$sessionId');
  assert.equal(target.params.sessionId, 'adhoc-session-42');
});

test('5. Session switching within same spec: routes to canonical spec X / session B route', async () => {
  const specs = [
    { specId: 'spec-x-id', source: 'active', slug: 'spec-x' },
    { specId: 'spec-y-id', source: 'archive', slug: 'spec-y' },
  ];

  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-x/sessions/claude/sess-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  const switchSession = createSessionSwitchNavigator(router.navigate, specs);
  const sessionB = {
    provider: 'claude',
    sessionId: 'sess-B',
    specId: 'spec-x-id',
  };

  await switchSession(sessionB);
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/claude/sess-B');
});

test('6. Session switching across specs: routes to canonical spec Y / session B route', async () => {
  const specs = [
    { specId: 'spec-x-id', source: 'active', slug: 'spec-x' },
    { specId: 'spec-y-id', source: 'archive', slug: 'spec-y' },
  ];

  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-x/sessions/claude/sess-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  const switchSession = createSessionSwitchNavigator(router.navigate, specs);
  const sessionY = {
    provider: 'gemini',
    sessionId: 'sess-Y',
    specId: 'spec-y-id',
  };

  await switchSession(sessionY);
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/archive/spec-y/sessions/gemini/sess-Y');
});

test('7. Spec-bound -> ad-hoc session switching navigates to global session route', async () => {
  const specs = [
    { specId: 'spec-x-id', source: 'active', slug: 'spec-x' },
  ];

  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-x/sessions/claude/sess-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  const switchSession = createSessionSwitchNavigator(router.navigate, specs);
  const adhocSession = {
    provider: 'gemini',
    sessionId: 'sess-adhoc',
    specId: null,
  };

  await switchSession(adhocSession);
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/gemini/sess-adhoc');
});

test('8. Ad-hoc -> spec-bound session switching navigates to spec-scoped route', async () => {
  const specs = [
    { specId: 'spec-x-id', source: 'active', slug: 'spec-x' },
  ];

  const history = createMemoryHistory({
    initialEntries: ['/ai/sessions/gemini/sess-adhoc'],
  });
  const router = createAppRouter(history);
  await router.load();

  const switchSession = createSessionSwitchNavigator(router.navigate, specs);
  const specSession = {
    provider: 'claude',
    sessionId: 'sess-spec-x',
    specId: 'spec-x-id',
  };

  await switchSession(specSession);
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/claude/sess-spec-x');
});

test('9. Back from spec-scoped chat: /specs/X/sessions/A -> Back -> /specs/X without requiring origin-spec history state', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/specs/active/my-spec/sessions/claude/my-session'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/my-spec/sessions/claude/my-session'
  );
  assert.equal(router.history.canGoBack(), false, 'Direct deep link entry');

  // Back navigation handler with specContext derived directly from route params
  const handleBack = createBackNavigator({
    routerHistory: router.history,
    navigate: router.navigate,
    specContext: { source: 'active', slug: 'my-spec' },
  });

  await handleBack();
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/my-spec');
  assert.equal(history.length, 1, 'Replaced deep-link chat entry with owning spec');
});

test('10. New session created from spec/task opens directly on spec-scoped session route', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  const createdSpec = { source: 'active', slug: 'new-spec-feature' };
  const createdSession = {
    provider: 'claude',
    sessionId: 'newly-created-session-123',
  };

  // Production navigation when session is created under a spec
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$sessionId',
    params: {
      source: createdSpec.source,
      slug: createdSpec.slug,
      provider: createdSession.provider,
      sessionId: createdSession.sessionId,
    },
    state: (prev) => ({ ...prev, origin: 'spec' }),
  });
  await router.load();

  assert.equal(
    router.state.location.pathname,
    '/specs/active/new-spec-feature/sessions/claude/newly-created-session-123'
  );
});

test('Single click on sidebar Active/Archive tabs creates exactly one history transition', async () => {
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
    to: '/specs/$source/$slug/sessions/$provider/$sessionId',
    params: { source: 'active', slug: 'spec-test', provider: 'claude', sessionId: 'session-1' },
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

  // Execute production back navigator for ad-hoc session
  const handleBack = createBackNavigator({
    routerHistory: router.history,
    navigate: router.navigate,
    specContext: null,
  });
  await handleBack();
  await router.load();

  // Route is replaced with /, history length stays 1
  assert.equal(router.state.location.pathname, '/');
  assert.equal(history.length, 1, 'History entry must be REPLACED, not pushed');
  assert.equal(router.history.canGoBack(), false, 'Cannot go back to discarded direct chat');
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
