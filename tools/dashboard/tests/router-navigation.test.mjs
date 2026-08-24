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

test('Item 10 (TanStack Router): Route tree resolves primary application screens and parses params/search', async () => {
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

test('Item 10 (TanStack Router): Redirect aliases route to canonical URLs', async () => {
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

test('Item 10 (TanStack Router): Memory history supports Back and Forward navigation without duplicate state', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createAppRouter(history);
  await router.load();

  // Navigate to spec
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'ux-improvements-version-1' },
  });
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');

  // Navigate to chat
  await router.navigate({
    to: '/ai/sessions/$provider/$sessionId',
    params: { provider: 'claude', sessionId: 'sess-1' },
  });
  assert.equal(router.state.location.pathname, '/ai/sessions/claude/sess-1');

  // History back -> returns to spec
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');

  // History back -> returns to dashboard
  router.history.back();
  await router.load();
  assert.equal(router.state.location.pathname, '/');

  // History forward -> returns to spec
  router.history.forward();
  await router.load();
  assert.equal(router.state.location.pathname, '/specs/active/ux-improvements-version-1');
});

test('Item 10 (TanStack Router): App.tsx mounts RouterProvider and uses authoritative router state', () => {
  const appSource = readSource('App.tsx');

  assert.ok(appSource.includes("import { RouterProvider } from '@tanstack/react-router'"));
  assert.ok(appSource.includes("import { router } from './router'"));
  assert.ok(appSource.includes('<RouterProvider router={router} />'));
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
