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
  resolveSessionDestination,
} from '../src/router-tree.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../src/' + relative, import.meta.url)), 'utf8');
}

test('Route tree resolves primary screens with clean URLs', async () => {
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

  // 5. Global AI Chat Route
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

test('1. Spec chat Back: /specs/:source/:slug/sessions/:provider/:sessionId -> Back navigates directly to parent /specs/:source/:slug', async () => {
  // Even if history previously contains '/' or another route, Back goes directly to the parent route
  const history = createMemoryHistory({
    initialEntries: ['/', '/specs/active/other-spec', '/specs/active/foo/sessions/claude/123'],
  });
  const router = createAppRouter(history);
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/foo/sessions/claude/123');

  // Application Back action in SpecChatRouteComponent:
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'foo' },
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/foo', 'Back always navigates to parent spec');
});

test('2. Open spec session: /specs/X -> click session A belonging to X -> exactly one navigation to /specs/X/sessions/A', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  const specs = [{ specId: 'spec-x-id', source: 'active', slug: 'spec-x' }];
  const sessionA = { provider: 'claude', sessionId: 'sess-A', specId: 'spec-x-id' };

  const dest = resolveSessionDestination(sessionA, specs);
  assert.equal(dest.to, '/specs/$source/$slug/sessions/$provider/$sessionId');

  // Single navigation
  const prevLength = history.length;
  await router.navigate({
    to: dest.to,
    params: dest.params,
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/claude/sess-A');
  assert.equal(history.length, prevLength + 1, 'Exactly one navigation occurred');
});

test('3. Open session from task: task inside spec X -> open session A -> single navigation to /specs/X/sessions/A and Back goes to /specs/X', async () => {
  const history = createMemoryHistory({ initialEntries: ['/specs/active/spec-x'] });
  const router = createAppRouter(history);
  await router.load();

  // User opens session from inside task dialog: exactly one navigation without pre-seeding history
  await router.navigate({
    to: '/specs/$source/$slug/sessions/$provider/$sessionId',
    params: { source: 'active', slug: 'spec-x', provider: 'claude', sessionId: 'sess-task' },
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/claude/sess-task');

  // Back from chat goes to parent spec
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'spec-x' },
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x');
});

test('4. Same-spec switch: X/session A -> select X/session B -> X/session B in one navigation', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-x/sessions/claude/sess-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  const specs = [{ specId: 'spec-x-id', source: 'active', slug: 'spec-x' }];
  const sessionB = { provider: 'claude', sessionId: 'sess-B', specId: 'spec-x-id' };

  const dest = resolveSessionDestination(sessionB, specs);
  await router.navigate({
    to: dest.to,
    params: dest.params,
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/claude/sess-B');
});

test('5. Cross-spec switch: X/session A -> select Y/session B -> Y/session B in one navigation and Back goes to spec Y', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-x/sessions/claude/sess-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  const specs = [
    { specId: 'spec-x-id', source: 'active', slug: 'spec-x' },
    { specId: 'spec-y-id', source: 'archive', slug: 'spec-y' },
  ];
  const sessionB = { provider: 'gemini', sessionId: 'sess-B', specId: 'spec-y-id' };

  const dest = resolveSessionDestination(sessionB, specs);
  await router.navigate({
    to: dest.to,
    params: dest.params,
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/archive/spec-y/sessions/gemini/sess-B');

  // Back from switched session goes to its current parent (spec Y)
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'archive', slug: 'spec-y' },
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/archive/spec-y');
});

test('6. Spec -> ad-hoc switch: X/session A -> ad-hoc B -> /ai/sessions/B without stale origin state', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-x/sessions/claude/sess-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  const specs = [{ specId: 'spec-x-id', source: 'active', slug: 'spec-x' }];
  const adhocSession = { provider: 'claude', sessionId: 'sess-adhoc-1', specId: null };

  const dest = resolveSessionDestination(adhocSession, specs);
  assert.equal(dest.to, '/ai/sessions/$provider/$sessionId');

  await router.navigate({
    to: dest.to,
    params: dest.params,
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/ai/sessions/claude/sess-adhoc-1');
});

test('7. Ad-hoc -> spec switch: /ai/sessions/A -> select X/session B -> /specs/X/sessions/B', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/ai/sessions/claude/sess-adhoc-1'],
  });
  const router = createAppRouter(history);
  await router.load();

  const specs = [{ specId: 'spec-x-id', source: 'active', slug: 'spec-x' }];
  const specSession = { provider: 'claude', sessionId: 'sess-B', specId: 'spec-x-id' };

  const dest = resolveSessionDestination(specSession, specs);
  assert.equal(dest.to, '/specs/$source/$slug/sessions/$provider/$sessionId');

  await router.navigate({
    to: dest.to,
    params: dest.params,
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x/sessions/claude/sess-B');
});

test('8. Invalid unresolved spec ownership: session.specId != null but spec cannot be resolved -> throws error, does not navigate to global', () => {
  const specs = [{ specId: 'spec-x-id', source: 'active', slug: 'spec-x' }];
  const orphanSession = { provider: 'claude', sessionId: 'sess-orphan', specId: 'unknown-spec-id' };

  assert.throws(
    () => resolveSessionDestination(orphanSession, specs),
    /Nie znaleziono specyfikacji o ID 'unknown-spec-id'/
  );
});

test('9. No post-render redirect: navigating from /specs/X/sessions/A to /specs/X keeps spec route mounted without reactively reopening A', async () => {
  const history = createMemoryHistory({
    initialEntries: ['/specs/active/spec-x/sessions/claude/sess-A'],
  });
  const router = createAppRouter(history);
  await router.load();

  // User navigates Back to /specs/active/spec-x
  await router.navigate({
    to: '/specs/$source/$slug',
    params: { source: 'active', slug: 'spec-x' },
  });
  await router.load();

  assert.equal(router.state.location.pathname, '/specs/active/spec-x');

  // Verify source code of router.tsx and spec-detail.tsx does not contain useEffect-based navigations
  const routerSource = readSource('router.tsx');
  const specDetailSource = readSource('components/spec-detail.tsx');

  assert.ok(!routerSource.includes('useEffect('), 'router.tsx must not have useEffect navigations');
  assert.ok(!specDetailSource.includes('restoreTaskId'), 'spec-detail.tsx must not have restoreTaskId');
  assert.ok(!specDetailSource.includes('initialTaskId'), 'spec-detail.tsx must not have initialTaskId');
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
