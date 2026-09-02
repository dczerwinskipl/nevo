import type {
  CanonicalTurnV2,
  CommentaryWorkItemV2,
  CurrentActivityV2,
  FinalAnswerV2,
  ToolActionV2,
  ToolInvocationWorkItemV2,
  ToolKindV2,
  ToolStatusV2,
  TurnStatusV2,
  WorkItemV2,
} from '../../types.ts';

const BASE_TIMESTAMP = '2026-09-02T12:00:00.000Z';

let nextSeq = 1;

/** Reset the sequence counter for deterministic testing across suites. */
export function resetFixtureSeq(start = 1): void {
  nextSeq = start;
}

// --- User Message Builder ---

export function buildUserMessage(options?: { text?: string; createdAt?: string }): {
  text: string;
  createdAt: string;
} {
  return {
    text: options?.text ?? 'Please review the test suite and verify storybook infrastructure.',
    createdAt: options?.createdAt ?? BASE_TIMESTAMP,
  };
}

// --- Final Answer Builder ---

export function buildFinalAnswer(options?: Partial<FinalAnswerV2>): FinalAnswerV2 {
  const status = options?.status ?? 'completed';
  return {
    id: options?.id ?? `final-ans-${nextSeq++}`,
    text:
      options?.text ??
      'I have reviewed the test suite and confirmed all 809 unit tests and Storybook component tests are passing.',
    status,
    confidence: options?.confidence ?? 'high',
    createdAt: options?.createdAt ?? BASE_TIMESTAMP,
    updatedAt: options?.updatedAt ?? BASE_TIMESTAMP,
    completedAt: status === 'completed' ? (options?.completedAt ?? BASE_TIMESTAMP) : undefined,
  };
}

// --- Commentary Builder ---

export function buildCommentary(options?: Partial<CommentaryWorkItemV2>): CommentaryWorkItemV2 {
  const status = options?.status ?? 'completed';
  return {
    id: options?.id ?? `work-commentary-${nextSeq++}`,
    seq: options?.seq ?? nextSeq++,
    type: 'commentary',
    text: options?.text ?? 'Analyzing the project structure and testing configuration…',
    status,
    confidence: options?.confidence ?? 'high',
    createdAt: options?.createdAt ?? BASE_TIMESTAMP,
    updatedAt: options?.updatedAt ?? BASE_TIMESTAMP,
    completedAt: status === 'completed' ? (options?.completedAt ?? BASE_TIMESTAMP) : undefined,
  };
}

// --- Base Tool Invocation Builder ---

export function buildToolInvocation(
  options: Partial<ToolInvocationWorkItemV2> & {
    toolName: string;
    kind: ToolKindV2;
    title: string;
    status?: ToolStatusV2;
  }
): ToolInvocationWorkItemV2 {
  const id = options.id ?? `tool-${options.toolName}-${nextSeq++}`;
  const status: ToolStatusV2 = options.status ?? 'completed';

  return {
    id,
    seq: options.seq ?? nextSeq++,
    type: 'tool',
    toolName: options.toolName,
    kind: options.kind,
    title: options.title,
    status,
    actions: options.actions ?? [],
    subject: options.subject,
    description: options.description,
    input: options.input,
    output: options.output,
    exitCode: options.exitCode ?? (status === 'failed' ? 1 : status === 'completed' ? 0 : undefined),
    durationMs: options.durationMs ?? (status === 'active' ? undefined : 240),
    startedAt: options.startedAt ?? BASE_TIMESTAMP,
    completedAt: status === 'completed' || status === 'failed' ? (options.completedAt ?? BASE_TIMESTAMP) : undefined,
    closureReason: options.closureReason,
    progress: options.progress,
    confidence: options.confidence,
    createdAt: options.createdAt ?? BASE_TIMESTAMP,
    updatedAt: options.updatedAt ?? BASE_TIMESTAMP,
  };
}

// --- Represented Tool Kinds Builders (Command, Read, Edit/Write, Search) ---

export function buildCommandTool(options?: Partial<ToolInvocationWorkItemV2>): ToolInvocationWorkItemV2 {
  const status = options?.status ?? 'completed';
  const defaultCommand = 'npm --prefix tools/dashboard test';
  return buildToolInvocation({
    toolName: 'run_command',
    kind: 'command',
    title: 'Run command',
    subject: options?.subject ?? 'npm test',
    description: options?.description ?? defaultCommand,
    input: options?.input ?? { CommandLine: defaultCommand, Cwd: 'D:/repos/git/nevo' },
    output: options?.output ?? (status === 'completed' ? 'PASS (809 tests)' : status === 'failed' ? 'FAIL: 1 error' : undefined),
    status,
    ...options,
  });
}

export function buildFileReadTool(options?: Partial<ToolInvocationWorkItemV2>): ToolInvocationWorkItemV2 {
  const targetFile = 'tools/dashboard/ui/index.css';
  return buildToolInvocation({
    toolName: 'view_file',
    kind: 'read',
    title: 'Read file',
    subject: options?.subject ?? 'index.css',
    description: options?.description ?? targetFile,
    input: options?.input ?? { AbsolutePath: `D:/repos/git/nevo/${targetFile}` },
    output: options?.output ?? ':root { color-scheme: dark; ... }',
    ...options,
  });
}

export function buildFileEditTool(options?: Partial<ToolInvocationWorkItemV2>): ToolInvocationWorkItemV2 {
  const targetFile = 'tools/dashboard/ui/foundations/colors.stories.tsx';
  return buildToolInvocation({
    toolName: 'replace_file_content',
    kind: 'edit',
    title: 'Edit file',
    subject: options?.subject ?? 'colors.stories.tsx',
    description: options?.description ?? targetFile,
    input: options?.input ?? { TargetFile: `D:/repos/git/nevo/${targetFile}` },
    output: options?.output ?? 'Replacement applied successfully.',
    ...options,
  });
}

export function buildFileWriteTool(options?: Partial<ToolInvocationWorkItemV2>): ToolInvocationWorkItemV2 {
  const targetFile = 'tools/dashboard/ui/foundations/typography.stories.tsx';
  return buildToolInvocation({
    toolName: 'write_to_file',
    kind: 'write',
    title: 'Write file',
    subject: options?.subject ?? 'typography.stories.tsx',
    description: options?.description ?? targetFile,
    input: options?.input ?? { TargetFile: `D:/repos/git/nevo/${targetFile}` },
    output: options?.output ?? 'Created file successfully.',
    ...options,
  });
}

export function buildSearchTool(options?: Partial<ToolInvocationWorkItemV2>): ToolInvocationWorkItemV2 {
  return buildToolInvocation({
    toolName: 'grep_search',
    kind: 'search',
    title: 'Search code',
    subject: options?.subject ?? 'text-2xl',
    description: options?.description ?? 'Search for "text-2xl" in tools/dashboard/ui',
    input: options?.input ?? { Query: 'text-2xl', SearchPath: 'tools/dashboard/ui' },
    output: options?.output ?? 'Found 7 matches in 3 files.',
    ...options,
  });
}

// --- Grouped Commands Scenario Builder ---

export function buildGroupedCommandsScenario(
  count = 3,
  baseOptions?: Partial<ToolInvocationWorkItemV2>
): ToolInvocationWorkItemV2[] {
  const items: ToolInvocationWorkItemV2[] = [];
  for (let i = 1; i <= count; i++) {
    items.push(
      buildCommandTool({
        id: `grouped-cmd-${i}-${nextSeq++}`,
        subject: `Step ${i}: build`,
        description: `npm --prefix tools/dashboard run step-${i}`,
        status: 'completed',
        ...baseOptions,
      })
    );
  }
  return items;
}

// --- Long Content Builders (AC2: Exercise wrapping / truncation) ---

export const LONG_COMMAND_STRING =
  'npm --prefix tools/dashboard/features/subsystems/analytics run build -- --env=production --target=es2022 --max-old-space-size=8192 --config-override=custom-vite.config.ts --reporter=verbose-json-stream-with-full-stack-traces';

export const LONG_PATH_STRING =
  'D:/repos/git/nevo/tools/dashboard/ui/features/agent-sessions/transcript/subcomponents/panels/nested-inspection/very-deeply-nested-session-transcript-inspection-view.component.tsx';

export const LONG_COMMENTARY_TEXT =
  'Investigating the performance metrics across all 14 active font-size scales, 8 line-height configurations, and 5 font weights. The inspection indicates that system fallbacks are functioning appropriately under headless Chromium environments, with no layout shifts detected between initial paint and hydration. Continuing to monitor streaming events for subsequent verification batches.';

export function buildLongCommandTool(options?: Partial<ToolInvocationWorkItemV2>): ToolInvocationWorkItemV2 {
  return buildCommandTool({
    subject: 'very-deeply-nested-subsystem-build-process',
    description: LONG_COMMAND_STRING,
    input: { CommandLine: LONG_COMMAND_STRING, Cwd: 'D:/repos/git/nevo' },
    output: `Executed command successfully:\n${LONG_COMMAND_STRING}\nOutput produced 42 artifacts.`,
    ...options,
  });
}

export function buildLongPathTool(options?: Partial<ToolInvocationWorkItemV2>): ToolInvocationWorkItemV2 {
  return buildFileReadTool({
    subject: 'very-deeply-nested-session-transcript-inspection-view.component.tsx',
    description: LONG_PATH_STRING,
    input: { AbsolutePath: LONG_PATH_STRING },
    ...options,
  });
}

export function buildLongCommentary(options?: Partial<CommentaryWorkItemV2>): CommentaryWorkItemV2 {
  return buildCommentary({
    text: LONG_COMMENTARY_TEXT,
    ...options,
  });
}

// --- Canonical Turn Builder & Scenarios ---

export function buildCanonicalTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  const id = options?.id ?? `turn-${nextSeq++}`;
  const work = options?.work ?? [];
  const status: TurnStatusV2 = options?.status ?? {
    status: 'terminal',
    outcome: 'completed',
    initiator: 'agent',
    since: BASE_TIMESTAMP,
    source: 'turn.completed',
  };

  return {
    id,
    turnId: options?.turnId ?? id,
    sessionId: options?.sessionId ?? 'session-fixture-01',
    provider: options?.provider ?? 'antigravity',
    providerSessionId: options?.providerSessionId ?? 'prov-session-01',
    mode: options?.mode ?? 'agent',
    status,
    work,
    historicalWork: options?.historicalWork ?? work,
    activityCount: options?.activityCount ?? work.length,
    currentActivity: options?.currentActivity ?? null,
    finalAnswer: options?.finalAnswer ?? null,
    userMessage: options?.userMessage ?? buildUserMessage(),
    terminalOutcome: options?.terminalOutcome ?? (status.status === 'terminal' ? {
      outcome: status.outcome,
      initiator: status.initiator,
      completedAt: BASE_TIMESTAMP,
    } : undefined),
    createdAt: options?.createdAt ?? BASE_TIMESTAMP,
    updatedAt: options?.updatedAt ?? BASE_TIMESTAMP,
    completedAt: status.status === 'terminal' ? (options?.completedAt ?? BASE_TIMESTAMP) : undefined,
    ...options,
  };
}

/** Scenario: Empty turn waiting for user or initialization. */
export function buildEmptyWaitingTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  return buildCanonicalTurn({
    status: { status: 'waiting', reason: 'provider_response', since: BASE_TIMESTAMP, source: 'turn.started' },
    work: [],
    historicalWork: [],
    activityCount: 0,
    currentActivity: null,
    finalAnswer: null,
    terminalOutcome: undefined,
    ...options,
  });
}

/** Scenario: Turn actively executing a tool with currentActivity. */
export function buildActiveRunningTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  const activeTool = buildCommandTool({ status: 'active' });
  const currentActivity: CurrentActivityV2 = {
    kind: 'tool',
    subjectId: activeTool.id,
    title: activeTool.title,
    subject: activeTool.subject,
    description: activeTool.description,
    toolKind: activeTool.kind,
    toolName: activeTool.toolName,
    status: 'active',
    activeCount: 1,
    startedAt: BASE_TIMESTAMP,
  };

  return buildCanonicalTurn({
    status: { status: 'active', detail: 'tool_execution', since: BASE_TIMESTAMP, source: 'tool.started' },
    work: [activeTool],
    historicalWork: [],
    activityCount: 1,
    currentActivity,
    finalAnswer: null,
    terminalOutcome: undefined,
    ...options,
  });
}

/** Scenario: Fully completed turn with user message, commentary, tools, and final answer. */
export function buildCompletedConversationTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  const commentary = buildCommentary();
  const fileRead = buildFileReadTool();
  const cmd = buildCommandTool();
  const work: WorkItemV2[] = [commentary, fileRead, cmd];

  return buildCanonicalTurn({
    status: { status: 'terminal', outcome: 'completed', initiator: 'agent', since: BASE_TIMESTAMP, source: 'turn.completed' },
    work,
    historicalWork: work,
    activityCount: work.length,
    currentActivity: null,
    finalAnswer: buildFinalAnswer(),
    ...options,
  });
}

/** Scenario: Turn that failed with a terminal error. */
export function buildFailedTurn(
  error = { code: 'COMMAND_EXIT_NONZERO', message: 'Build command failed with exit code 1' },
  options?: Partial<CanonicalTurnV2>
): CanonicalTurnV2 {
  const failedCmd = buildCommandTool({ status: 'failed', exitCode: 1 });

  return buildCanonicalTurn({
    status: { status: 'terminal', outcome: 'failed', initiator: 'agent', error, since: BASE_TIMESTAMP, source: 'turn.failed' },
    work: [failedCmd],
    historicalWork: [failedCmd],
    activityCount: 1,
    currentActivity: null,
    finalAnswer: null,
    terminalOutcome: {
      outcome: 'failed',
      initiator: 'agent',
      error,
      completedAt: BASE_TIMESTAMP,
    },
    ...options,
  });
}
