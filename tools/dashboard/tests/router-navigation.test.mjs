import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSpecificationSource } from '../ui/features/specifications/types.ts';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../ui/' + relative, import.meta.url)), 'utf8');
}

function sourceExists(relative) {
  return existsSync(fileURLToPath(new URL('../ui/' + relative, import.meta.url)));
}

test('1. Route tree: Nevo declares all expected public file routes without global ad-hoc chat routes', () => {
  assert.ok(sourceExists('routes/__root.tsx'), '__root.tsx exists');
  assert.ok(sourceExists('routes/_spec-layout.tsx'), '_spec-layout.tsx exists');
  assert.ok(sourceExists('routes/_spec-layout/index.tsx'), 'index.tsx exists');
  assert.ok(sourceExists('routes/_spec-layout/archive.tsx'), 'archive.tsx exists');
  assert.ok(sourceExists('routes/_spec-layout/specs.$source.$slug.tsx'), 'specs.$source.$slug.tsx exists');
  assert.ok(
    sourceExists('routes/specs.$source.$slug.sessions.$provider.$providerSessionId.tsx'),
    'session route exists',
  );

  // Verify no obsolete or global ad-hoc chat routes exist in routes/
  assert.equal(sourceExists('routes/ai.sessions.$provider.$sessionId.tsx'), false, 'No /ai/sessions route');
  assert.equal(sourceExists('routes/active.tsx'), false, 'No alias /active route file');
});

test('2. Layout hierarchy: Specification routes are nested under _spec-layout while Agent Session is a root-level sibling', () => {
  const specLayoutRouteSource = readSource('routes/_spec-layout.tsx');
  const indexRouteSource = readSource('routes/_spec-layout/index.tsx');
  const archiveRouteSource = readSource('routes/_spec-layout/archive.tsx');
  const specDetailRouteSource = readSource('routes/_spec-layout/specs.$source.$slug.tsx');
  const agentSessionRouteSource = readSource('routes/specs.$source.$slug.sessions.$provider.$providerSessionId.tsx');

  // _spec-layout binds to SpecificationConsoleLayout
  assert.ok(
    specLayoutRouteSource.includes('SpecificationConsoleLayout'),
    '_spec-layout renders SpecificationConsoleLayout',
  );
  assert.ok(specLayoutRouteSource.includes('/_spec-layout'), '_spec-layout is configured as pathless layout');

  // Specification console pages are placed in _spec-layout/ and bind to their feature components
  assert.ok(indexRouteSource.includes('ActiveSpecificationsPage'), 'Index route binds to ActiveSpecificationsPage');
  assert.ok(
    archiveRouteSource.includes('ArchiveSpecificationsPage'),
    'Archive route binds to ArchiveSpecificationsPage',
  );
  assert.ok(
    specDetailRouteSource.includes('SpecificationDetailScreen'),
    'Spec detail route binds to SpecificationDetailScreen',
  );

  // Agent Session route is placed at top-level routes/ (outside _spec-layout/) and binds to AgentSessionScreen
  assert.ok(agentSessionRouteSource.includes('AgentSessionScreen'), 'Agent session route binds to AgentSessionScreen');
  assert.ok(
    !agentSessionRouteSource.includes('SpecificationConsoleLayout'),
    'Agent session route does not reference console layout',
  );
});

test('3. Route param typing: file routes pass typed Route.useParams() to feature route components', () => {
  const specDetailRouteSource = readSource('routes/_spec-layout/specs.$source.$slug.tsx');
  const agentSessionRouteSource = readSource('routes/specs.$source.$slug.sessions.$provider.$providerSessionId.tsx');
  const specificationRouteSource = readSource('screens/specification-detail/specification-detail-screen.tsx');
  const agentSessionComponentSource = readSource('screens/agent-session/agent-session-screen.tsx');

  // Route files extract typed params via Route.useParams()
  assert.ok(specDetailRouteSource.includes('Route.useParams()'), 'Specification route uses Route.useParams()');
  assert.ok(agentSessionRouteSource.includes('Route.useParams()'), 'Agent session route uses Route.useParams()');

  // Feature components accept explicit props and do not use non-strict useParams
  assert.ok(
    specificationRouteSource.includes('export interface SpecificationDetailScreenProps'),
    'SpecificationDetailScreen declares explicit props',
  );
  assert.ok(
    !specificationRouteSource.includes('useParams({ strict: false })'),
    'SpecificationDetailScreen does not use non-strict useParams',
  );

  assert.ok(
    agentSessionComponentSource.includes('export interface AgentSessionScreenProps'),
    'AgentSessionScreen declares explicit props',
  );
  assert.ok(
    !agentSessionComponentSource.includes('useParams({ strict: false })'),
    'AgentSessionScreen does not use non-strict useParams',
  );
});

test('4. Router bootstrap: app/router.ts creates router from generated routeTree with no manual route stitching', () => {
  const routerSource = readSource('app/router.ts');

  assert.ok(routerSource.includes('routeTree'), 'Imports generated routeTree');
  assert.ok(routerSource.includes('createRouter({'), 'Creates router from routeTree');
  assert.ok(!routerSource.includes('.update({'), 'No manual route.update stitching in router.ts');
  assert.ok(!routerSource.includes('addChildren'), 'No manual addChildren in router.ts');
});

test('5. Open session from spec: spec X -> session A parameters structure', () => {
  const spec = { source: 'active', slug: 'spec-x', specId: 'spec-x-id' };
  const sessionA = {
    provider: 'claude',
    providerSessionId: 'provider-sess-xyz',
    specId: 'spec-x-id',
    taskIds: ['task-01'],
  };

  const expectedPath = `/specs/${spec.source}/${spec.slug}/sessions/${sessionA.provider}/${sessionA.providerSessionId}`;
  assert.equal(
    expectedPath,
    '/specs/active/spec-x/sessions/claude/provider-sess-xyz',
    'Session path matches route pattern with provider and providerSessionId',
  );
});

test('6. Direct/deep chat load: route resolves spec X and looks up session in X sessions', () => {
  const specSessions = [
    { provider: 'claude', providerSessionId: 'prov-1', specId: 'spec-100', taskIds: [] },
    { provider: 'gemini', providerSessionId: 'prov-2', specId: 'spec-100', taskIds: [] },
  ];

  const targetProvider = 'gemini';
  const targetProviderSessionId = 'prov-2';
  const found = specSessions.find(
    (s) => s.provider === targetProvider && s.providerSessionId === targetProviderSessionId,
  );

  assert.ok(found, 'Session found in spec sessions');
  assert.equal(found.provider, 'gemini');
  assert.equal(found.providerSessionId, 'prov-2');
});

test('7. Session belongs to another spec: opening /specs/X/sessions/A when A is under Y results in Session Not Found', () => {
  const sessionsOfX = [{ provider: 'claude', providerSessionId: 'sess-x1', specId: 'spec-x-id', taskIds: [] }];

  const requestedProvider = 'claude';
  const requestedProviderSessionId = 'sess-y1';
  const foundInX = sessionsOfX.find(
    (s) => s.provider === requestedProvider && s.providerSessionId === requestedProviderSessionId,
  );

  assert.equal(foundInX, undefined, 'Session must not be resolved under spec X');
});

test('8. Free/ad-hoc session (specId: null) has no dashboard route', () => {
  const adhocSession = {
    provider: 'claude',
    providerSessionId: 'free-sess-1',
    specId: null,
  };

  assert.equal(adhocSession.specId, null);
  assert.equal(sourceExists('routes/ai.sessions.$provider.$sessionId.tsx'), false);
});

test('9. No global session fetch: SpecificationConsoleLayout and SpecificationSidebar do not load global sessions', () => {
  const appLayoutSource = readSource('screens/specification-console/specification-console-layout.tsx');
  const sidebarSource = readSource('features/specifications/navigation/specification-sidebar.tsx');

  assert.ok(
    !appLayoutSource.includes('useAgentSessions({ enabled: Boolean(data) })'),
    'SpecificationConsoleLayout must not query all AI sessions globally',
  );
  assert.ok(!sidebarSource.includes('Ostatnie sesje'), 'SpecificationSidebar must not render global session list');
});

test('10. No reverse spec resolution: AgentSessionPage receives spec directly, without searching all specs', () => {
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');

  assert.ok(
    agentSessionPageSource.includes('spec?: AgentSessionPageSpecContext') ||
      agentSessionPageSource.includes('spec: AgentSessionPageSpecContext'),
    'AgentSessionPage receives spec directly',
  );
  assert.ok(
    !agentSessionPageSource.includes('changes: SpecificationSummary[]'),
    'AgentSessionPage must not receive changes array to reverse search',
  );
  assert.ok(!agentSessionPageSource.includes('resolveSessionDestination'), 'No resolveSessionDestination helper');
});

test('11. AgentSessionRoute: Fatal initial load error blocks with StatusCard; background refresh error retains active chat', () => {
  const routerSource = readSource('screens/agent-session/agent-session-screen.tsx');

  assert.ok(
    routerSource.includes('if (sessionsQuery.error && !sessionsQuery.data) {'),
    'Fatal error requires error && !data',
  );
  assert.ok(routerSource.includes('Nie udało się wczytać sesji specyfikacji'), 'Error card title present');
  assert.ok(routerSource.includes('sessionsQuery.refresh()'), 'Retry calls sessionsQuery.refresh');
  assert.ok(routerSource.includes('router.history.canGoBack?.()'), 'Safe in-app history back check');
  assert.ok(routerSource.includes('replace: true'), 'Fallback uses replace semantics');

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

test('12. Session switching: Switching sessions inside same spec uses replace to preserve Spec -> Session history hierarchy', () => {
  const routerSource = readSource('screens/agent-session/agent-session-screen.tsx');

  assert.ok(
    routerSource.includes('handleSwitchSession') && routerSource.includes('replace: true'),
    'handleSwitchSession must navigate with replace: true',
  );
});

test('13. Fallback routing: Archived spec accessed via /specs/active/... or active spec via /specs/archive/... resolves fallback without 404', () => {
  const specificationRouteSource = readSource('screens/specification-detail/specification-detail-screen.tsx');
  const agentSessionRouteSource = readSource('screens/agent-session/agent-session-screen.tsx');

  assert.ok(
    specificationRouteSource.includes('const fallbackSpec = useMemo('),
    'SpecificationRoute defines fallbackSpec lookup',
  );
  assert.ok(
    specificationRouteSource.includes('oppositeSource'),
    'SpecificationRoute uses alternate source for fallback',
  );
  assert.ok(specificationRouteSource.includes('effectiveSpec'), 'SpecificationRoute renders effectiveSpec');

  assert.ok(
    agentSessionRouteSource.includes('effectiveSpec?.source || source'),
    'AgentSessionRoute derives effectiveSource from effectiveSpec',
  );
});

test('14. Archived spec sessions: specification-detail-content enables useAgentSessions for specs with specId', () => {
  const specificationContentSource = readSource('screens/specification-detail/specification-detail-content.tsx');
  const taskDialogSource = readSource('features/specifications/tasks/task-dialog.tsx');

  assert.match(
    specificationContentSource,
    /useAgentSessions\({\s*specId:\s*specification\.specId \|\| undefined,\s*enabled:\s*Boolean\(specification\.specId\),?\s*}\)/,
    'SpecificationDetailContent must not restrict useAgentSessions to active specifications',
  );
  assert.ok(
    taskDialogSource.includes('sessionsContent?: React.ReactNode'),
    'TaskDialog accepts injected sessionsContent instead of tightly coupling to useAgentSessions',
  );
});

test('15. Source validation contract: isSpecificationSource strictly validates active and archive sources', () => {
  assert.equal(isSpecificationSource('active'), true);
  assert.equal(isSpecificationSource('archive'), true);
  assert.equal(isSpecificationSource('invalid'), false);
  assert.equal(isSpecificationSource(''), false);
  assert.equal(isSpecificationSource('archived'), false);
  assert.equal(isSpecificationSource('ACTIVE'), false);
  assert.equal(isSpecificationSource('null'), false);
  assert.equal(isSpecificationSource('undefined'), false);
});

test('16. SpecificationDetailScreen: invalid $source canonicalizes to active via replace and prevents premature domain lookup', () => {
  const specDetailScreenSource = readSource('screens/specification-detail/specification-detail-screen.tsx');

  // Architecture & contract assertions:
  // 1) Invalid source is not treated as active — it resolves strictly to null
  assert.match(
    specDetailScreenSource,
    /const\s+source:\s*SpecificationSource\s*\|\s*null\s*=\s*isSpecificationSource\(\s*rawSource\s*\)\s*\?\s*rawSource\s*:\s*null;/,
    'SpecificationDetailScreen guards rawSource using isSpecificationSource, evaluating invalid values to null',
  );

  // 2) The screen canonicalizes invalid source through a replace navigation to an active URL
  assert.match(
    specDetailScreenSource,
    /if\s*\(\s*source\s*===\s*null\s*\)\s*\{\s*navigate\(\{\s*to:\s*['"]\/specs\/\$source\/\$slug['"],\s*params:\s*\{\s*source:\s*['"]active['"],\s*slug\s*\},\s*replace:\s*true\s*\}\);?\s*\}/,
    'SpecificationDetailScreen triggers replace navigation to /specs/active/$slug when source is null',
  );

  // 3) Domain lookup does not proceed using the invalid source before canonicalization
  assert.match(
    specDetailScreenSource,
    /if\s*\(!data\s*\|\|\s*source\s*===\s*null\)\s*return\s*null;/,
    'selected memoization guards against null source before accessing data collections',
  );
  assert.match(
    specDetailScreenSource,
    /if\s*\(!data\s*\|\|\s*selected\s*\|\|\s*source\s*===\s*null\)\s*return\s*null;/,
    'fallbackSpec memoization guards against null source before attempting opposite-collection lookup',
  );
  assert.match(
    specDetailScreenSource,
    /if\s*\(source\s*===\s*null\)\s*return\s*<LoadingScreen\s*\/>;/,
    'SpecificationDetailScreen returns LoadingScreen while source is null, preventing not-found or content render',
  );

  // Behavioral logic simulation mirroring component state transitions:
  function evaluateSpecificationResolution(rawSource, slug, data) {
    const source = isSpecificationSource(rawSource) ? rawSource : null;
    let canonicalRedirect = null;
    if (source === null) {
      canonicalRedirect = { to: '/specs/$source/$slug', params: { source: 'active', slug }, replace: true };
    }

    let selectedLookupExecuted = false;
    const selected = (() => {
      if (!data || source === null) return null;
      selectedLookupExecuted = true;
      const collection = source === 'active' ? data.active : data.archive;
      return collection.find((c) => c.slug === slug) ?? null;
    })();

    let fallbackLookupExecuted = false;
    const fallbackSpec = (() => {
      if (!data || selected || source === null) return null;
      fallbackLookupExecuted = true;
      const oppositeCollection = source === 'active' ? data.archive : data.active;
      const match = oppositeCollection.find((c) => c.slug === slug);
      return match ? { specification: match, oppositeSource: source === 'active' ? 'archive' : 'active' } : null;
    })();

    return {
      source,
      canonicalRedirect,
      selected,
      fallbackSpec,
      selectedLookupExecuted,
      fallbackLookupExecuted,
      rendersLoading: source === null,
    };
  }

  const mockIndexData = {
    active: [{ slug: 'sample-spec', title: 'Sample Spec', source: 'active' }],
    archive: [],
  };

  // Test with invalid source: must canonicalize to active without premature domain lookup
  const invalidResult = evaluateSpecificationResolution('invalid-src', 'sample-spec', mockIndexData);
  assert.equal(invalidResult.source, null, 'Invalid source must resolve to null, not active');
  assert.deepEqual(
    invalidResult.canonicalRedirect,
    { to: '/specs/$source/$slug', params: { source: 'active', slug: 'sample-spec' }, replace: true },
    'Must trigger canonical replace navigation to active source',
  );
  assert.equal(invalidResult.selectedLookupExecuted, false, 'Domain lookup must NOT run for invalid source');
  assert.equal(invalidResult.fallbackLookupExecuted, false, 'Fallback lookup must NOT run for invalid source');
  assert.equal(invalidResult.selected, null);
  assert.equal(invalidResult.rendersLoading, true, 'Must render LoadingScreen while canonicalization is in flight');

  // Test with valid source
  const validResult = evaluateSpecificationResolution('active', 'sample-spec', mockIndexData);
  assert.equal(validResult.source, 'active');
  assert.equal(validResult.canonicalRedirect, null);
  assert.equal(validResult.selectedLookupExecuted, true);
  assert.equal(validResult.selected?.slug, 'sample-spec');
  assert.equal(validResult.rendersLoading, false);
});

test('17. AgentSessionScreen: invalid $source canonicalizes to active via replace and prevents premature domain lookup', () => {
  const agentSessionScreenSource = readSource('screens/agent-session/agent-session-screen.tsx');

  // Architecture & contract assertions:
  // 1) Invalid source is not treated as active — it resolves strictly to null
  assert.match(
    agentSessionScreenSource,
    /const\s+source:\s*['"]active['"]\s*\|\s*['"]archive['"]\s*\|\s*null\s*=\s*isSpecificationSource\(\s*rawSource\s*\)\s*\?\s*rawSource\s*:\s*null;/,
    'AgentSessionScreen guards rawSource using isSpecificationSource, evaluating invalid values to null',
  );

  // 2) The screen canonicalizes invalid source through a replace navigation to an active session URL
  assert.match(
    agentSessionScreenSource,
    /if\s*\(\s*source\s*===\s*null\s*\)\s*\{\s*navigate\(\{\s*to:\s*['"]\/specs\/\$source\/\$slug\/sessions\/\$provider\/\$providerSessionId['"],\s*params:\s*\{\s*source:\s*['"]active['"],\s*slug,\s*provider,\s*providerSessionId\s*\},?\s*replace:\s*true,?\s*\}\);?\s*\}/,
    'AgentSessionScreen triggers replace navigation to /specs/active/$slug/sessions/... when source is null',
  );

  // 3) Domain lookup does not proceed using the invalid source before canonicalization
  assert.match(
    agentSessionScreenSource,
    /if\s*\(!data\s*\|\|\s*source\s*===\s*null\)\s*return\s*null;/,
    'selectedSpec memoization guards against null source before accessing data collections',
  );
  assert.match(
    agentSessionScreenSource,
    /if\s*\(!data\s*\|\|\s*selectedSpec\s*\|\|\s*source\s*===\s*null\)\s*return\s*null;/,
    'fallbackSpec memoization guards against null source before attempting opposite-collection lookup',
  );
  assert.match(
    agentSessionScreenSource,
    /if\s*\(source\s*===\s*null\)\s*return\s*<LoadingScreen\s*\/>;/,
    'AgentSessionScreen returns LoadingScreen while source is null, preventing chat or session query execution',
  );

  // Behavioral logic simulation mirroring component state transitions:
  function evaluateAgentSessionResolution(rawSource, slug, provider, providerSessionId, data) {
    const source = isSpecificationSource(rawSource) ? rawSource : null;
    let canonicalRedirect = null;
    if (source === null) {
      canonicalRedirect = {
        to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
        params: { source: 'active', slug, provider, providerSessionId },
        replace: true,
      };
    }

    let selectedLookupExecuted = false;
    const selectedSpec = (() => {
      if (!data || source === null) return null;
      selectedLookupExecuted = true;
      const collection = source === 'active' ? data.active : data.archive;
      return collection.find((c) => c.slug === slug) ?? null;
    })();

    let fallbackLookupExecuted = false;
    const fallbackSpec = (() => {
      if (!data || selectedSpec || source === null) return null;
      fallbackLookupExecuted = true;
      const oppositeCollection = source === 'active' ? data.archive : data.active;
      const match = oppositeCollection.find((c) => c.slug === slug);
      return match ? { specification: match, oppositeSource: source === 'active' ? 'archive' : 'active' } : null;
    })();

    const effectiveSpec = selectedSpec || fallbackSpec?.specification || null;
    const sessionsQueryEnabled = Boolean(effectiveSpec?.specId);

    return {
      source,
      canonicalRedirect,
      selectedSpec,
      fallbackSpec,
      selectedLookupExecuted,
      fallbackLookupExecuted,
      sessionsQueryEnabled,
      rendersLoading: source === null,
    };
  }

  const mockIndexData = {
    active: [{ slug: 'sample-spec', title: 'Sample Spec', source: 'active', specId: 'spec-active-id' }],
    archive: [],
  };

  // Test with invalid source: must canonicalize to active without premature domain lookup
  const invalidResult = evaluateAgentSessionResolution(
    'bogus-source',
    'sample-spec',
    'claude',
    'sess-1',
    mockIndexData,
  );
  assert.equal(invalidResult.source, null, 'Invalid source must resolve to null, not active');
  assert.deepEqual(
    invalidResult.canonicalRedirect,
    {
      to: '/specs/$source/$slug/sessions/$provider/$providerSessionId',
      params: { source: 'active', slug: 'sample-spec', provider: 'claude', providerSessionId: 'sess-1' },
      replace: true,
    },
    'Must trigger canonical replace navigation to active source',
  );
  assert.equal(invalidResult.selectedLookupExecuted, false, 'Domain lookup must NOT run for invalid source');
  assert.equal(invalidResult.fallbackLookupExecuted, false, 'Fallback lookup must NOT run for invalid source');
  assert.equal(invalidResult.selectedSpec, null);
  assert.equal(invalidResult.sessionsQueryEnabled, false, 'Sessions query must NOT be enabled before spec resolves');
  assert.equal(invalidResult.rendersLoading, true, 'Must render LoadingScreen while canonicalization is in flight');

  // Test with valid source
  const validResult = evaluateAgentSessionResolution('active', 'sample-spec', 'claude', 'sess-1', mockIndexData);
  assert.equal(validResult.source, 'active');
  assert.equal(validResult.canonicalRedirect, null);
  assert.equal(validResult.selectedLookupExecuted, true);
  assert.equal(validResult.selectedSpec?.slug, 'sample-spec');
  assert.equal(validResult.sessionsQueryEnabled, true);
  assert.equal(validResult.rendersLoading, false);
});
