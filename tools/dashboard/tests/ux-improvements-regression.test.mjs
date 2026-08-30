import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL('../ui/' + relative, import.meta.url)), 'utf8');
}

test('Item 1 (Task 04): AgentSessionComposer uses canonical AI_MODES metadata with no duplicate MODE_METAS', () => {
  const composerSource = readSource('features/agent-sessions/composer/agent-session-composer.tsx');
  const aiModeMetaSource = readSource('features/agent-sessions/mode-meta.ts');

  // Must import AI_MODES from mode-meta
  assert.ok(composerSource.includes("import { AI_MODES, getModeMeta } from '../mode-meta';") || composerSource.includes("from '../mode-meta'"));
  assert.ok(!composerSource.includes('const MODE_METAS:'), 'Local MODE_METAS must be removed from agent-session-composer.tsx');

  // Must render mode buttons iterating over AI_MODES with descriptions
  assert.ok(composerSource.includes('AI_MODES.map((modeMeta) =>'));
  assert.ok(composerSource.includes('title={`${modeMeta.label} - ${modeMeta.description}`}'));
  assert.ok(composerSource.includes('aria-label={`${modeMeta.label}: ${modeMeta.description}`}'));

  // mode-meta.ts exports canonical modes
  assert.ok(aiModeMetaSource.includes('export const AI_MODES'));
  assert.ok(aiModeMetaSource.includes("id: 'ask'"));
  assert.ok(aiModeMetaSource.includes("id: 'edit'"));
  assert.ok(aiModeMetaSource.includes("id: 'agent'"));
});

test('Item 2A & 2B (Task 07 / Item 9A): AgentSessionRow uses non-interactive card, semantic sibling buttons, and interactive task chips', () => {
  const sessionListSource = readSource('features/agent-sessions/agent-session-list.tsx');

  // Outer container is a non-interactive div without role=button or tabIndex=0
  assert.ok(!sessionListSource.includes('role="button"'), 'Outer card must not be role=button');

  // Primary open session link/button exists as its own control
  assert.ok(sessionListSource.includes('onOpen(session)'));

  // Task links are styled as interactive chips with CheckSquare icon and hover/focus states
  assert.ok(sessionListSource.includes('onOpenTask && matchedTask ? ('));
  assert.ok(sessionListSource.includes('<CheckSquare'));
  assert.ok(sessionListSource.includes('cursor-pointer'));
  assert.ok(sessionListSource.includes('<span className="truncate">{label}</span>'));

  // Delete button is a dedicated button
  assert.ok(sessionListSource.includes('title="Usuń sesję z dysku"'));
});

test('Item 2B & 2C (Task 07): AgentSessionDetails and AgentSessionPage resolve tasks against change and use TaskNavigationTarget', () => {
  const sessionDetailsSource = readSource('features/agent-sessions/agent-session-details.tsx');
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');
  const typesSource = readSource('features/agent-sessions/types.ts');

  // TaskNavigationTarget contract exists in types.ts
  assert.ok(typesSource.includes('export interface TaskNavigationTarget {'));
  assert.ok(typesSource.includes('taskId: string;'));

  // AgentSessionDetails supports normalized tasks and inert rendering for stale tasks
  assert.ok(sessionDetailsSource.includes('export interface SessionTaskItem {'));
  assert.ok(sessionDetailsSource.includes('onOpenTask?: (target: TaskNavigationTarget) => void'));
  assert.ok(sessionDetailsSource.includes('onOpenTask?.({ taskId: taskItem.id, specSlug })'));

  // AgentSessionPage resolves rawTaskIds against change.tasks and passes specSlug
  assert.ok(agentSessionPageSource.includes('const sessionTaskItems = useMemo('));
  assert.ok(agentSessionPageSource.includes('change?.tasks?.find'));
  assert.ok(agentSessionPageSource.includes('specSlug={change?.slug}'));
  assert.ok(agentSessionPageSource.includes('tasks={sessionTaskItems}'));
});

test('Item 2C, 2D & Item 9B/9C: Reusable TaskDialog component is mounted from both SpecificationDetail and AgentSessionPage without leaveChat()', () => {
  const taskDialogSource = readSource('features/specifications/tasks/task-dialog.tsx');
  const specDetailSource = readSource('features/specifications/detail/specification-detail.tsx');
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');

  // TaskDialog is a reusable component in features/specifications/tasks/task-dialog.tsx
  assert.ok(taskDialogSource.includes('export function TaskDialog('));
  assert.ok(taskDialogSource.includes('export interface TaskDialogProps'));
  assert.ok(taskDialogSource.includes('useSpecificationDocument('));
  assert.ok(taskDialogSource.includes('useSpecificationActions('));
  assert.ok(taskDialogSource.includes('useAgentSessions('));

  // SpecificationDetail imports and mounts TaskDialog
  assert.ok(specDetailSource.includes("import { TaskDialog } from '../tasks/task-dialog';"));
  assert.ok(specDetailSource.includes('<TaskDialog'));
  assert.ok(specDetailSource.includes('taskId={selectedTask.id}'));

  // AgentSessionPage imports and mounts TaskDialog locally as an overlay without calling leaveChat()
  assert.ok(agentSessionPageSource.includes("import { TaskDialog } from '@/features/specifications/tasks/task-dialog';"));
  assert.ok(agentSessionPageSource.includes('const [inspectedTaskId, setInspectedTaskId] = useState<string | null>(null);'));
  assert.ok(agentSessionPageSource.includes('setInspectedTaskId(taskId);'));
  assert.ok(agentSessionPageSource.includes('<TaskDialog'));
  assert.ok(agentSessionPageSource.includes('taskId={inspectedTaskId}'));
  assert.ok(agentSessionPageSource.includes('onClose={() => setInspectedTaskId(null)}'));
});

test('Item 4 (Task 12): Compact icon-only connectivity indicator uses semantic state', () => {
  const connectivityControlsSource = readSource('app/connectivity-controls.tsx');

  // Indicator is icon-only in header with role=status, tabIndex=0, title, aria-label
  assert.ok(connectivityControlsSource.includes('role="status"'));
  assert.ok(connectivityControlsSource.includes('tabIndex={0}'));
  assert.ok(connectivityControlsSource.includes('Połączenie na żywo aktywne (SSE: Połączono)'));
  assert.ok(connectivityControlsSource.includes('SSE: Połączono (aktualizacje na żywo aktywne)'));
  assert.ok(connectivityControlsSource.includes('border-[var(--success-border)] bg-[var(--success-muted)] text-[var(--success)]'));
  assert.ok(connectivityControlsSource.includes('border-[var(--warning-border)] bg-[var(--warning-muted)] text-[var(--warning)]'));
  assert.ok(connectivityControlsSource.includes('border-[var(--danger-border)] bg-[var(--danger-muted)] text-[var(--danger)]'));
  assert.ok(connectivityControlsSource.includes('border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]'));
  assert.ok(!connectivityControlsSource.includes('<span className="hidden sm:inline">{live ? \'SSE: Połączono\' : \'SSE: Rozłączono\'}</span>'), 'Text pill must not remain in header');
});

test('Item 5 (Task 14 AC1 & Finding 2): TaskCard uses a full-width title, compact metadata, and a separate action footer', () => {
  const statusBoardSource = readSource('features/specifications/detail/status-board.tsx');

  // 1. Outer card is non-interactive div without role=button or tabIndex=0
  assert.ok(!statusBoardSource.includes('role="button"'), 'TaskCard outer div must not have role=button');
  assert.ok(!statusBoardSource.includes('tabIndex={0}'), 'TaskCard outer div must not have tabIndex=0');

  // 2. Dedicated semantic button for opening task details gets the full card width
  assert.ok(statusBoardSource.includes('onClick={event => onSelect?.(task, event.currentTarget)}'));
  assert.ok(statusBoardSource.includes('aria-label={`Otwórz szczegóły zadania: ${task.title}`}'));
  assert.ok(statusBoardSource.includes('mt-2.5 block w-full'));

  // 3. Exact task status, dependencies, and blockers share one compact metadata header
  assert.ok(statusBoardSource.includes('<StatusLabel kind="task" status={task.status}'));
  assert.ok(statusBoardSource.includes('flex min-w-0 items-center gap-2'));
  assert.ok(statusBoardSource.includes('title={`Zależności: ${task.dependsOn.join(\', \')}`}'));
  assert.ok(statusBoardSource.includes('title={`Blokowane przez: ${task.blockedBy.join(\', \')}`}'));

  // 4. Action is a separate centered footer, not nested beside the title
  assert.ok(statusBoardSource.includes('mt-3 flex justify-center border-t border-[var(--border)] pt-2.5'));
  assert.ok(statusBoardSource.includes('onClick={() => onAction?.(task, actionGate.action)}'));
  assert.ok(statusBoardSource.includes('aria-label={`${actionGate.action === \'approve\' ? \'Zatwierdź zadanie\' : \'Zaakceptuj zadanie\'}: ${task.title}\`}'));
});

test('Item 6: AppSidebar cleanup of unused task/delete handlers', () => {
  const sidebarSource = readSource('features/specifications/navigation/app-sidebar.tsx');

  assert.ok(!sidebarSource.includes('useDeleteAgentSession'), 'useDeleteAgentSession must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('handleDeleteSession'), 'handleDeleteSession must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('onOpenTask'), 'onOpenTask must be removed from AppSidebar');
  assert.ok(!sidebarSource.includes('activeTasks'), 'activeTasks must be removed from AppSidebar');
});

test('Item 7 (Task 17): CreateAgentSessionDialog provider group uses semantic fieldset and aria-pressed', () => {
  const modalSource = readSource('features/agent-sessions/create-agent-session-dialog.tsx');

  // Provider group uses fieldset + legend, not label wrapping multiple buttons
  assert.ok(modalSource.includes('<fieldset className="mt-6">'));
  assert.ok(modalSource.includes('<legend className="text-xs font-semibold text-[var(--foreground)]">\n                Provider\n              </legend>') || modalSource.includes('Provider'));
  assert.ok(!modalSource.includes('<label className="mt-6 block text-xs font-semibold">\n              Provider'));

  // Provider buttons have aria-pressed
  assert.ok(modalSource.includes('aria-pressed={selected}'));

  // Execution mode buttons have aria-pressed
  assert.ok(modalSource.includes('aria-pressed={mode === item.id}'));
});

test('Item 8 (Task 18): Shared status label component and consistent session status labels across all 5 sites', () => {
  const statusLabelSource = readSource('components/status-label.tsx');
  const stageProgressSource = readSource('features/specifications/stage-progress.tsx');
  const statusBoardSource = readSource('features/specifications/detail/status-board.tsx');
  const sessionListSource = readSource('features/agent-sessions/agent-session-list.tsx');
  const agentSessionHeaderSource = readSource('features/agent-sessions/agent-session-header.tsx');
  const agentSessionPageSource = readSource('features/agent-sessions/agent-session-page.tsx');

  // 1. StatusLabel primitive owns common typography contract
  assert.ok(statusLabelSource.includes('export function StatusLabel'), 'StatusLabel component exported');
  assert.ok(statusLabelSource.includes('text-[10px] font-bold uppercase tracking-[0.1em]'), 'Typography contract owned by StatusLabel');
  assert.ok(statusLabelSource.includes('formatSessionStatus'), 'Shared formatSessionStatus exported');

  // 2. Site 1: stage-progress stage labels use StatusLabel
  assert.ok(stageProgressSource.includes("import { StatusLabel } from '@/components/status-label'"), 'stage-progress imports StatusLabel');
  assert.ok(stageProgressSource.includes('<StatusLabel className="truncate">{stage.label}</StatusLabel>'), 'stage-progress renders StatusLabel');

  // 3. Status-board lane headers and exact task statuses use the shared label primitive
  assert.ok(statusBoardSource.includes("from '@/components/status-label'"), 'status-board imports StatusLabel');
  assert.ok(statusBoardSource.includes('<StatusLabel className="text-[var(--muted-strong)]">{lane.shortLabel}</StatusLabel>'), 'status-board lane header renders StatusLabel');
  assert.ok(statusBoardSource.includes('<StatusLabel kind="task" status={task.status}'), 'task cards render the exact domain status as lightweight metadata');

  // 4. Site 4: agent-session-list session status uses StatusLabel
  assert.ok(sessionListSource.includes("from '@/components/status-label'"), 'agent-session-list imports from status-label');
  assert.ok(sessionListSource.includes('<StatusLabel kind="session" status={session.status} />'), 'agent-session-list renders StatusLabel');

  // 5. Site 5: agent session header status uses StatusLabel
  assert.ok(agentSessionHeaderSource.includes("import { StatusLabel } from '@/components/status-label'"), 'agent-session-header imports StatusLabel');
  assert.ok(agentSessionHeaderSource.includes('<StatusLabel>{status}</StatusLabel>'), 'agent-session-header renders StatusLabel');
  assert.ok(agentSessionPageSource.includes('formatSessionStatus(assistant.activity)'), 'agent-session-page passes formatSessionStatus to header');
});

test('Item 9 (Task 19): Standardize H2 scale on spec-detail to text-xl', () => {
  const specDetailSource = readSource('features/specifications/detail/overview-panel.tsx');
  const statusBoardSource = readSource('features/specifications/detail/status-board.tsx');

  // Both section h2 headings use text-xl
  assert.ok(specDetailSource.includes('<h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">Ostatnie rozmowy</h2>'));
  assert.ok(statusBoardSource.includes('text-xl font-semibold tracking-tight text-[var(--foreground)]'));
});

test('Item 10 (Task 20): CreateAgentSessionDialog closes on Escape when not creating', () => {
  const modalSource = readSource('features/agent-sessions/create-agent-session-dialog.tsx');

  // Escape key handler attached to window
  assert.ok(modalSource.includes("event.key === 'Escape'"));
  assert.ok(modalSource.includes('!createSession.creating'));
  assert.ok(modalSource.includes('onClose()'));
});
