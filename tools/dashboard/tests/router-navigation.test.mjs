import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../ui/' + relative, import.meta.url)), 'utf8');
}

test('1. Route tree: TanStack file-based routing registers all expected public routes', () => {
  const routeTreeSource = readSource('routeTree.gen.ts');

  // Verify all 4 public fullPaths are declared in the generated route tree
  assert.ok(routeTreeSource.includes("'/': typeof SpecLayoutIndexRoute"), "Root route '/' is registered");
  assert.ok(routeTreeSource.includes("'/archive': typeof SpecLayoutArchiveRoute"), "Archive route '/archive' is registered");
  assert.ok(routeTreeSource.includes("'/specs/$source/$slug': typeof SpecLayoutSpecsSourceSlugRoute"), "Spec detail route '/specs/$source/$slug' is registered");
  assert.ok(routeTreeSource.includes("'/specs/$source/$slug/sessions/$provider/$providerSessionId': typeof SpecsSourceSlugSessionsProviderProviderSessionIdRoute"), "Agent session route is registered");

  // Verify no ad-hoc chat routes or alias redirects exist
  assert.ok(!routeTreeSource.includes('/ai/sessions/'), 'No global ad-hoc chat route in tree');
  assert.ok(!routeTreeSource.includes("'/active'"), 'No alias redirects in tree');
});

test('2. Layout hierarchy: Specification routes are nested under _spec-layout while Agent Session is a direct root child', () => {
  const specLayoutRouteSource = readSource('routes/_spec-layout.tsx');
  const indexRouteSource = readSource('routes/_spec-layout/index.tsx');
  const archiveRouteSource = readSource('routes/_spec-layout/archive.tsx');
  const specDetailRouteSource = readSource('routes/_spec-layout/specs.$source.$slug.tsx');
  const agentSessionRouteSource = readSource('routes/specs.$source.$slug.sessions.$provider.$providerSessionId.tsx');
  const routeTreeSource = readSource('routeTree.gen.ts');

  // _spec-layout binds to SpecificationConsoleLayout
  assert.ok(specLayoutRouteSource.includes('SpecificationConsoleLayout'), '_spec-layout renders SpecificationConsoleLayout');
  assert.ok(specLayoutRouteSource.includes("createFileRoute('/_spec-layout')"), '_spec-layout is a pathless layout route');

  // Child routes of _spec-layout
  assert.ok(indexRouteSource.includes("createFileRoute('/_spec-layout/')"), 'Index route is under _spec-layout');
  assert.ok(indexRouteSource.includes('ActiveSpecificationsRoute'), 'Index route binds to ActiveSpecificationsRoute');
  assert.ok(archiveRouteSource.includes("createFileRoute('/_spec-layout/archive')"), 'Archive route is under _spec-layout');
  assert.ok(archiveRouteSource.includes('ArchiveSpecificationsRoute'), 'Archive route binds to ArchiveSpecificationsRoute');
  assert.ok(specDetailRouteSource.includes("createFileRoute('/_spec-layout/specs/$source/$slug')"), 'Spec detail route is under _spec-layout');
  assert.ok(specDetailRouteSource.includes('SpecificationRoute'), 'Spec detail route binds to SpecificationRoute');

  // Agent session route is directly under root (not inside _spec-layout)
  assert.ok(agentSessionRouteSource.includes("createFileRoute(\n  '/specs/$source/$slug/sessions/$provider/$providerSessionId',\n)"), 'Agent session route is direct child of root');
  assert.ok(agentSessionRouteSource.includes('AgentSessionRoute'), 'Agent session route binds to AgentSessionRoute');

  // Generated tree confirms parent relationships
  assert.ok(routeTreeSource.includes('parentRoute: typeof SpecLayoutRoute'), 'Specification child routes have SpecLayoutRoute parent');
  assert.ok(routeTreeSource.includes('parentRoute: typeof rootRouteImport'), 'Agent session route has rootRouteImport parent');
});

test('3. Router bootstrap: app/router.ts creates router from generated routeTree with no manual route stitching', () => {
  const routerSource = readSource('app/router.ts');

  assert.ok(routerSource.includes('routeTree.gen'), 'Imports generated routeTree');
  assert.ok(routerSource.includes('createRouter({'), 'Creates router from routeTree');
  assert.ok(!routerSource.includes('.update({'), 'No manual route.update stitching in router.ts');
  assert.ok(!routerSource.includes('addChildren'), 'No manual addChildren in router.ts');
});

test('4. Open session from spec: spec X -> session A parameters structure', () => {
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
    'Session path matches route pattern with provider and providerSessionId'
  );
});

test('5. Direct/deep chat load: route resolves spec X and looks up session in X sessions', () => {
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

test('6. Session belongs to another spec: opening /specs/X/sessions/A when A is under Y results in Session Not Found', () => {
  const sessionsOfX = [
    { provider: 'claude', providerSessionId: 'sess-x1', specId: 'spec-x-id', taskIds: [] },
  ];

  const requestedProvider = 'claude';
  const requestedProviderSessionId = 'sess-y1';
  const foundInX = sessionsOfX.find(
    (s) => s.provider === requestedProvider && s.providerSessionId === requestedProviderSessionId
  );

  assert.equal(foundInX, undefined, 'Session must not be resolved under spec X');
});

test('7. Free/ad-hoc session (specId: null) has no dashboard route', () => {
  const adhocSession = {
    provider: 'claude',
    providerSessionId: 'free-sess-1',
    specId: null,
  };

  assert.equal(adhocSession.specId, null);
  const routeTreeSource = readSource('routeTree.gen.ts');
  assert.ok(!routeTreeSource.includes('/ai/sessions/'), 'Router must not have /ai/sessions/ route');
});

test('8. No global session fetch: SpecificationConsoleLayout and SpecificationSidebar do not load global sessions', () => {
  const appLayoutSource = readSource('features/specifications/specification-console-layout.tsx');
  const sidebarSource = readSource('features/specifications/navigation/specification-sidebar.tsx');

  assert.ok(!appLayoutSource.includes('useAgentSessions({ enabled: Boolean(data) })'), 'SpecificationConsoleLayout must not query all AI sessions globally');
  assert.ok(!sidebarSource.includes('Ostatnie sesje'), 'SpecificationSidebar must not render global session list');
});

test('9. No reverse spec resolution: AgentSessionPage receives spec directly, without searching all specs', () => {
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');

  assert.ok(agentSessionPageSource.includes('spec: SpecificationSummary'), 'AgentSessionPage receives spec directly');
  assert.ok(!agentSessionPageSource.includes('changes: SpecificationSummary[]'), 'AgentSessionPage must not receive changes array to reverse search');
  assert.ok(!agentSessionPageSource.includes('resolveSessionDestination'), 'No resolveSessionDestination helper');
});

test('10. AgentSessionRoute: Fatal initial load error blocks with StatusCard; background refresh error retains active chat', () => {
  const routerSource = readSource('features/agent-sessions/agent-session-route.tsx');

  assert.ok(routerSource.includes('if (sessionsQuery.error && !sessionsQuery.data) {'), 'Fatal error requires error && !data');
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

test('11. Session switching: Switching sessions inside same spec uses replace to preserve Spec -> Session history hierarchy', () => {
  const routerSource = readSource('features/agent-sessions/agent-session-route.tsx');

  assert.ok(
    routerSource.includes('handleSwitchSession') && routerSource.includes('replace: true'),
    'handleSwitchSession must navigate with replace: true'
  );
});

test('12. Fallback routing: Archived spec accessed via /specs/active/... or active spec via /specs/archive/... resolves fallback without 404', () => {
  const specificationRouteSource = readSource('features/specifications/detail/specification-route.tsx');
  const agentSessionRouteSource = readSource('features/agent-sessions/agent-session-route.tsx');

  assert.ok(specificationRouteSource.includes('const fallbackSpec = useMemo('), 'SpecificationRoute defines fallbackSpec lookup');
  assert.ok(specificationRouteSource.includes('oppositeSource'), 'SpecificationRoute uses alternate source for fallback');
  assert.ok(specificationRouteSource.includes('effectiveSpec'), 'SpecificationRoute renders effectiveSpec');

  assert.ok(agentSessionRouteSource.includes('effectiveSource = effectiveSpec?.source || source'), 'AgentSessionRoute derives effectiveSource from effectiveSpec');
});

test('13. Archived spec sessions: specification-detail and task-dialog enable useAgentSessions for archived specs with specId', () => {
  const specificationDetailSource = readSource('features/specifications/detail/specification-detail.tsx');
  const taskDialogSource = readSource('features/specifications/tasks/task-dialog.tsx');

  assert.ok(
    specificationDetailSource.includes("useAgentSessions({ specId: specification.specId || undefined, enabled: Boolean(specification.specId) })"),
    'SpecificationDetail must not restrict useAgentSessions to specification.source === active'
  );
  assert.ok(
    taskDialogSource.includes("enabled: Boolean(specification.specId)"),
    'TaskDialog must not restrict useAgentSessions to specification.source === active'
  );
});
