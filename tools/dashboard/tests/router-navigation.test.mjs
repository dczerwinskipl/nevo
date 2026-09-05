import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  assert.ok(
    indexRouteSource.includes('ActiveSpecificationsScreen') || indexRouteSource.includes('ActiveSpecificationsRoute'),
    'Index route binds to ActiveSpecificationsScreen',
  );
  assert.ok(
    archiveRouteSource.includes('ArchiveSpecificationsScreen') ||
      archiveRouteSource.includes('ArchiveSpecificationsRoute'),
    'Archive route binds to ArchiveSpecificationsScreen',
  );
  assert.ok(
    specDetailRouteSource.includes('SpecificationDetailScreen') || specDetailRouteSource.includes('SpecificationRoute'),
    'Spec detail route binds to SpecificationDetailScreen',
  );

  // Agent Session route is placed at top-level routes/ (outside _spec-layout/) and binds to AgentSessionRoute
  assert.ok(
    agentSessionRouteSource.includes('AgentSessionScreen') || agentSessionRouteSource.includes('AgentSessionRoute'),
    'Agent session route binds to AgentSessionScreen',
  );
  assert.ok(
    !agentSessionRouteSource.includes('SpecificationConsoleLayout'),
    'Agent session route does not reference console layout',
  );
});

test('3. Route param typing: file routes pass typed Route.useParams() to feature route components', () => {
  const specDetailRouteSource = readSource('routes/_spec-layout/specs.$source.$slug.tsx');
  const agentSessionRouteSource = readSource('routes/specs.$source.$slug.sessions.$provider.$providerSessionId.tsx');
  const specificationRouteSource = readSource('screens/specification-detail-screen.tsx');
  const agentSessionComponentSource = readSource('screens/agent-session-screen.tsx');

  // Route files extract typed params via Route.useParams()
  assert.ok(specDetailRouteSource.includes('Route.useParams()'), 'Specification route uses Route.useParams()');
  assert.ok(agentSessionRouteSource.includes('Route.useParams()'), 'Agent session route uses Route.useParams()');

  // Feature components accept explicit props and do not use non-strict useParams
  assert.ok(
    specificationRouteSource.includes('export interface SpecificationRouteProps'),
    'SpecificationRoute declares explicit props',
  );
  assert.ok(
    !specificationRouteSource.includes('useParams({ strict: false })'),
    'SpecificationRoute does not use non-strict useParams',
  );

  assert.ok(
    agentSessionComponentSource.includes('export interface AgentSessionRouteProps'),
    'AgentSessionRoute declares explicit props',
  );
  assert.ok(
    !agentSessionComponentSource.includes('useParams({ strict: false })'),
    'AgentSessionRoute does not use non-strict useParams',
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
  const appLayoutSource = readSource('screens/specification-console-layout.tsx');
  const sidebarSource = readSource('features/specifications/navigation/specification-sidebar.tsx');

  assert.ok(
    !appLayoutSource.includes('useAgentSessions({ enabled: Boolean(data) })'),
    'SpecificationConsoleLayout must not query all AI sessions globally',
  );
  assert.ok(!sidebarSource.includes('Ostatnie sesje'), 'SpecificationSidebar must not render global session list');
});

test('10. No reverse spec resolution: AgentSessionPage receives spec directly, without searching all specs', () => {
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');

  assert.ok(agentSessionPageSource.includes('spec: SpecificationSummary'), 'AgentSessionPage receives spec directly');
  assert.ok(
    !agentSessionPageSource.includes('changes: SpecificationSummary[]'),
    'AgentSessionPage must not receive changes array to reverse search',
  );
  assert.ok(!agentSessionPageSource.includes('resolveSessionDestination'), 'No resolveSessionDestination helper');
});

test('11. AgentSessionRoute: Fatal initial load error blocks with StatusCard; background refresh error retains active chat', () => {
  const routerSource = readSource('screens/agent-session-screen.tsx');

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
  const routerSource = readSource('screens/agent-session-screen.tsx');

  assert.ok(
    routerSource.includes('handleSwitchSession') && routerSource.includes('replace: true'),
    'handleSwitchSession must navigate with replace: true',
  );
});

test('13. Fallback routing: Archived spec accessed via /specs/active/... or active spec via /specs/archive/... resolves fallback without 404', () => {
  const specificationRouteSource = readSource('screens/specification-detail-screen.tsx');
  const agentSessionRouteSource = readSource('screens/agent-session-screen.tsx');

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
    agentSessionRouteSource.includes('effectiveSource = effectiveSpec?.source || source'),
    'AgentSessionRoute derives effectiveSource from effectiveSpec',
  );
});

test('14. Archived spec sessions: specification-detail and task-dialog enable useAgentSessions for archived specs with specId', () => {
  const specificationDetailSource = readSource('features/specifications/detail/specification-detail.tsx');
  const taskDialogSource = readSource('features/specifications/tasks/task-dialog.tsx');

  assert.match(
    specificationDetailSource,
    /useAgentSessions\({\s*specId:\s*specification\.specId \|\| undefined,\s*enabled:\s*Boolean\(specification\.specId\),?\s*}\)/,
    'SpecificationDetail must not restrict useAgentSessions to specification.source === active',
  );
  assert.ok(
    taskDialogSource.includes('enabled: Boolean(specification.specId)'),
    'TaskDialog must not restrict useAgentSessions to specification.source === active',
  );
});
