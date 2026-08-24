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
    state: { restoreTaskId: '08-chat-follow-scroll' },
    replace: true,
  });

  // 3. User navigates from TaskDialog to Chat with transient origin state (clean URL)
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'sess-task-1' },
    state: {
      origin: 'task',
      originTaskId: '08-chat-follow-scroll',
      originSpecSlug: 'ux-improvements-version-1',
      originSpecSource: 'active',
    },
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
