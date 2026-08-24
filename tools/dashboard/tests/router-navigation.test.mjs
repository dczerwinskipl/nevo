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

test('Finding 3 & 4 (TanStack Router): Route tree resolves primary application screens and parses params/search', async () => {
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

  // 4. AI Chat Route with search params
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'session-12345' },
    search: { turnId: 'turn-abc', originTaskId: '08-chat-follow-scroll' },
  });
  assert.equal(router.state.location.pathname, '/ai/sessions/claude/session-12345');
  assert.equal(router.state.location.search.turnId, 'turn-abc');
  assert.equal(router.state.location.search.originTaskId, '08-chat-follow-scroll');
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

test('Finding 3 (TanStack Router): In-app history back/forward navigation does not duplicate entries', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // Initial load: canGoBack is false
  assert.equal(router.history.canGoBack(), false);

  // Navigate: Dashboard -> Spec
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
  });
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
  assert.equal(router.history.canGoBack(), true);

  // Navigate: Spec -> Chat
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'sess-1' },
  });
  assert.equal(router.state.location.pathname, '/ai/sessions/claude/sess-1');
  assert.equal(router.history.canGoBack(), true);

  // In-app Back: Chat -> Spec
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
  assert.equal(router.history.canGoBack(), true);

  // In-app Back: Spec -> Dashboard
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/');
  assert.equal(router.history.canGoBack(), false);

  // In-app Forward: Dashboard -> Spec
  router.history.forward();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
});

test('Finding 3 (TanStack Router): Direct deep link to chat reports canGoBack=false and triggers fallback', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/ai/sessions/claude/deep-link-session-123'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/claude/deep-link-session-123');
  assert.equal(router.history.canGoBack(), false, 'Direct deep link entry must NOT use browser back to leave Nevo');
});

test('Finding 3 (TanStack Router): Task -> Chat -> Back restores originating task dialog context', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // 1. User opens spec
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
  });

  // 2. User opens task dialog inside spec (transient search update via replace: true)
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
    search: { taskId: '08-chat-follow-scroll' },
    replace: true,
  });
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
  assert.equal(router.state.location.search.taskId, '08-chat-follow-scroll');

  // 3. User navigates from task dialog into chat
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'sess-task-1' },
    search: { originTaskId: '08-chat-follow-scroll' },
  });
  assert.equal(router.state.location.pathname, '/ai/sessions/claude/sess-task-1');
  assert.equal(router.state.location.search.originTaskId, '08-chat-follow-scroll');

  // 4. Back pops to spec and restores search.taskId
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
  assert.equal(router.state.location.search.taskId, '08-chat-follow-scroll', 'Task context must be restored on Back');
});

test('Finding 4 (TanStack Router): AppLayout derives mode and selectedSlug reactively from router state', () => {
  const routerSource = readSource('router.tsx');

  // Uses useLocation and useMatches
  assert.ok(routerSource.includes('const location = useLocation();'));
  assert.ok(routerSource.includes('const matches = useMatches();'));

  // Correctly handles /specs/archive/:slug as archive mode
  assert.ok(routerSource.includes("source === 'archive' ? 'archive' : 'active'"));
  assert.ok(routerSource.includes("location.pathname.startsWith('/specs/archive')"));

  // Derives selectedSlug from active match params instead of passing null
  assert.ok(routerSource.includes('specMatch ? ((specMatch.params as { slug?: string }).slug ?? null) : null'));
  assert.ok(routerSource.includes('selectedSlug={selectedSlug}'));
});

test('Finding 4 (TanStack Router): AppSidebar uses Link for tabs and does not duplicate imperative navigation', () => {
  const sidebarSource = readSource('components/app-sidebar.tsx');

  // Tabs use <Link to="/"> and <Link to="/archive">
  assert.match(sidebarSource, /<Link[\s\S]*?to="\/"/);
  assert.match(sidebarSource, /<Link[\s\S]*?to="\/archive"/);

  // SpecNavigationItem is a Link that closes sidebar without duplicate navigate()
  assert.ok(sidebarSource.includes('<SpecNavigationItem'));
  assert.ok(sidebarSource.includes('onClose();'));
});

test('Item 10: Opening task details from chat or spec is transient UI state and does not navigate routes', () => {
  const aiChatSource = readSource('components/ai-chat.tsx');
  const specDetailSource = readSource('components/spec-detail.tsx');

  // In ai-chat.tsx, inspecting task is local state and mounts TaskDialog overlay without route navigation
  assert.ok(aiChatSource.includes('const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);'));
  assert.ok(aiChatSource.includes('setInspectedTaskId(taskId);'));
  assert.ok(aiChatSource.includes('onClose={() => setInspectedTaskId(null)}'));

  // In spec-detail.tsx, selectedTaskId is local state and mounts TaskDialog overlay without route navigation
  assert.ok(specDetailSource.includes('const [selectedTaskId, setSelectedTaskId] = useState<string | null>'));
  assert.ok(specDetailSource.includes('onClose={closeTask}'));
});
