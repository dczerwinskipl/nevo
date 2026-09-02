import type {
  CanonicalTurnV2,
  CommentaryWorkItemV2,
  CurrentActivityV2,
  FinalAnswerV2,
  ReasoningWorkItemV2,
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

/** Override options for specialized tool builders that protect builder invariants. */
export type ToolOverrideOptions = Omit<
  Partial<ToolInvocationWorkItemV2>,
  'kind' | 'toolName' | 'title'
>;

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

// --- Commentary & Reasoning Builders ---

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

export function buildReasoning(options?: Partial<ReasoningWorkItemV2>): ReasoningWorkItemV2 {
  const status = options?.status ?? 'completed';
  return {
    id: options?.id ?? `work-reasoning-${nextSeq++}`,
    seq: options?.seq ?? nextSeq++,
    type: 'reasoning',
    representation: options?.representation ?? 'summary',
    text: options?.text ?? 'Evaluating implementation trade-offs for active streaming states…',
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
  const isTerminal =
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted';

  const defaultDurationMs = isTerminal ? 240 : undefined;
  const defaultCompletedAt = isTerminal ? BASE_TIMESTAMP : undefined;

  let defaultExitCode: number | undefined = undefined;
  if (options.kind === 'command' || options.kind === 'test') {
    if (status === 'completed') defaultExitCode = 0;
    else if (status === 'failed') defaultExitCode = 1;
  }

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
    exitCode: options.exitCode !== undefined ? options.exitCode : defaultExitCode,
    durationMs: options.durationMs !== undefined ? options.durationMs : defaultDurationMs,
    startedAt: options.startedAt ?? BASE_TIMESTAMP,
    completedAt: options.completedAt !== undefined ? options.completedAt : defaultCompletedAt,
    closureReason: options.closureReason,
    progress: options.progress,
    confidence: options.confidence,
    createdAt: options.createdAt ?? BASE_TIMESTAMP,
    updatedAt: options.updatedAt ?? BASE_TIMESTAMP,
  };
}

// --- Represented Tool Kinds Builders (Command, Read, Edit/Write, Search) ---

export function buildCommandTool(options?: ToolOverrideOptions): ToolInvocationWorkItemV2 {
  const status = options?.status ?? 'completed';
  const defaultCommand = 'npm --prefix tools/dashboard test';

  let defaultOutput: unknown = undefined;
  if (status === 'completed') {
    defaultOutput = 'PASS (809 tests)';
  } else if (status === 'failed') {
    defaultOutput = 'Command failed with exit code 1';
  }

  const { kind: _k, toolName: _tn, title: _t, ...safeOverrides } = (options ?? {}) as any;

  return buildToolInvocation({
    subject: 'npm test',
    description: defaultCommand,
    input: { CommandLine: defaultCommand, Cwd: 'D:/repos/git/nevo' },
    output: defaultOutput,
    status,
    ...safeOverrides,
    kind: 'command',
    toolName: 'run_command',
    title: 'Run command',
  });
}

export function buildFileReadTool(options?: ToolOverrideOptions): ToolInvocationWorkItemV2 {
  const status = options?.status ?? 'completed';
  const targetFile = 'tools/dashboard/ui/index.css';

  let defaultOutput: unknown = undefined;
  if (status === 'completed') {
    defaultOutput = ':root { color-scheme: dark; ... }';
  } else if (status === 'failed') {
    defaultOutput = 'Error: ENOENT: no such file or directory';
  }

  const { kind: _k, toolName: _tn, title: _t, ...safeOverrides } = (options ?? {}) as any;

  return buildToolInvocation({
    subject: 'index.css',
    description: targetFile,
    input: { AbsolutePath: `D:/repos/git/nevo/${targetFile}` },
    output: defaultOutput,
    status,
    ...safeOverrides,
    kind: 'read',
    toolName: 'view_file',
    title: 'Read file',
  });
}

export function buildFileEditTool(options?: ToolOverrideOptions): ToolInvocationWorkItemV2 {
  const status = options?.status ?? 'completed';
  const targetFile = 'tools/dashboard/ui/foundations/colors.stories.tsx';

  let defaultOutput: unknown = undefined;
  if (status === 'completed') {
    defaultOutput = 'Replacement applied successfully.';
  } else if (status === 'failed') {
    defaultOutput = 'Error: target content not found in file';
  }

  const { kind: _k, toolName: _tn, title: _t, ...safeOverrides } = (options ?? {}) as any;

  return buildToolInvocation({
    subject: 'colors.stories.tsx',
    description: targetFile,
    input: { TargetFile: `D:/repos/git/nevo/${targetFile}` },
    output: defaultOutput,
    status,
    ...safeOverrides,
    kind: 'edit',
    toolName: 'replace_file_content',
    title: 'Edit file',
  });
}

export function buildFileWriteTool(options?: ToolOverrideOptions): ToolInvocationWorkItemV2 {
  const status = options?.status ?? 'completed';
  const targetFile = 'tools/dashboard/ui/foundations/typography.stories.tsx';

  let defaultOutput: unknown = undefined;
  if (status === 'completed') {
    defaultOutput = 'Created file successfully.';
  } else if (status === 'failed') {
    defaultOutput = 'Error: permission denied writing to file';
  }

  const { kind: _k, toolName: _tn, title: _t, ...safeOverrides } = (options ?? {}) as any;

  return buildToolInvocation({
    subject: 'typography.stories.tsx',
    description: targetFile,
    input: { TargetFile: `D:/repos/git/nevo/${targetFile}` },
    output: defaultOutput,
    status,
    ...safeOverrides,
    kind: 'write',
    toolName: 'write_to_file',
    title: 'Write file',
  });
}

export function buildSearchTool(options?: ToolOverrideOptions): ToolInvocationWorkItemV2 {
  const status = options?.status ?? 'completed';

  let defaultOutput: unknown = undefined;
  if (status === 'completed') {
    defaultOutput = 'Found 7 matches in 3 files.';
  } else if (status === 'failed') {
    defaultOutput = 'Error: search pattern regex syntax error';
  }

  const { kind: _k, toolName: _tn, title: _t, ...safeOverrides } = (options ?? {}) as any;

  return buildToolInvocation({
    subject: 'text-2xl',
    description: 'Search for "text-2xl" in tools/dashboard/ui',
    input: { Query: 'text-2xl', SearchPath: 'tools/dashboard/ui' },
    output: defaultOutput,
    status,
    ...safeOverrides,
    kind: 'search',
    toolName: 'grep_search',
    title: 'Search code',
  });
}

// --- Grouped Commands Scenario Builder ---

export function buildGroupedCommandsScenario(
  count = 3,
  baseOptions?: ToolOverrideOptions
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

export function buildLongCommandTool(options?: ToolOverrideOptions): ToolInvocationWorkItemV2 {
  const status = options?.status ?? 'completed';
  const customOutput =
    options?.output !== undefined
      ? options.output
      : status === 'completed'
        ? `Executed command successfully:\n${LONG_COMMAND_STRING}\nOutput produced 42 artifacts.`
        : status === 'failed'
          ? `Command failed with error:\n${LONG_COMMAND_STRING}\nExit code 1.`
          : undefined;

  return buildCommandTool({
    subject: 'very-deeply-nested-subsystem-build-process',
    description: LONG_COMMAND_STRING,
    input: { CommandLine: LONG_COMMAND_STRING, Cwd: 'D:/repos/git/nevo' },
    ...options,
    output: customOutput,
  });
}

export function buildLongPathTool(options?: ToolOverrideOptions): ToolInvocationWorkItemV2 {
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

  const currentActivity = options?.currentActivity ?? null;
  const activeId = currentActivity?.subjectId;

  const historicalWork =
    options?.historicalWork !== undefined
      ? options.historicalWork
      : activeId
        ? work.filter((item) => item.id !== activeId)
        : work;

  const activityCount = options?.activityCount ?? work.length;

  return {
    id,
    turnId: options?.turnId ?? id,
    sessionId: options?.sessionId ?? 'session-fixture-01',
    provider: options?.provider ?? 'antigravity',
    providerSessionId: options?.providerSessionId ?? 'prov-session-01',
    mode: options?.mode ?? 'agent',
    status,
    work,
    historicalWork,
    activityCount,
    currentActivity,
    finalAnswer: options?.finalAnswer !== undefined ? options.finalAnswer : null,
    userMessage: options?.userMessage ?? buildUserMessage(),
    terminalOutcome:
      options?.terminalOutcome !== undefined
        ? options.terminalOutcome
        : status.status === 'terminal'
          ? {
              outcome: status.outcome,
              initiator: status.initiator,
              error: status.error,
              completedAt: BASE_TIMESTAMP,
            }
          : undefined,
    createdAt: options?.createdAt ?? BASE_TIMESTAMP,
    updatedAt: options?.updatedAt ?? BASE_TIMESTAMP,
    completedAt:
      options?.completedAt !== undefined
        ? options.completedAt
        : status.status === 'terminal'
          ? BASE_TIMESTAMP
          : undefined,
  };
}

/** Scenario: Empty turn waiting for user or initialization. */
export function buildEmptyWaitingTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  const status: TurnStatusV2 = options?.status ?? {
    status: 'waiting',
    reason: 'provider_response',
    since: BASE_TIMESTAMP,
    source: 'turn.started',
  };
  const startedAt = 'since' in status && status.since ? status.since : BASE_TIMESTAMP;

  const currentActivity: CurrentActivityV2 | null =
    options?.currentActivity !== undefined
      ? options.currentActivity
      : {
          kind: 'waiting_for_model',
          title: 'Waiting for model response',
          status: 'running',
          startedAt,
        };

  return buildCanonicalTurn({
    status,
    work: [],
    historicalWork: [],
    activityCount: 0,
    currentActivity,
    finalAnswer: null,
    terminalOutcome: undefined,
    ...options,
  });
}

/** Scenario: Turn actively executing a tool with currentActivity. */
export function buildActiveRunningTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  const suppliedTool = (options?.work?.find(
    (w): w is ToolInvocationWorkItemV2 => 'type' in w && w.type === 'tool'
  ) ?? options?.work?.[0]) as ToolInvocationWorkItemV2 | undefined;

  const activeTool = suppliedTool ?? buildCommandTool({ status: 'active' });
  const work = options?.work ?? [activeTool];
  const activeId = options?.currentActivity?.subjectId ?? activeTool.id;

  const currentActivity: CurrentActivityV2 = options?.currentActivity ?? {
    kind: 'tool',
    subjectId: activeId,
    title: activeTool.title,
    subject: activeTool.subject,
    description: activeTool.description,
    toolKind: activeTool.kind,
    toolName: activeTool.toolName,
    status: 'active',
    activeCount: 1,
    startedAt: activeTool.startedAt ?? BASE_TIMESTAMP,
  };

  const historicalWork =
    options?.historicalWork !== undefined
      ? options.historicalWork
      : work.filter((w) => w.id !== currentActivity.subjectId);
  const activityCount = options?.activityCount ?? work.length;

  return buildCanonicalTurn({
    status: {
      status: 'active',
      detail: 'tool_execution',
      subjectId: activeId,
      since: activeTool.startedAt ?? BASE_TIMESTAMP,
      source: 'tool.started',
    },
    finalAnswer: null,
    terminalOutcome: undefined,
    ...options,
    work,
    historicalWork,
    activityCount,
    currentActivity,
  });
}

/** Scenario: Active thinking / commentary turn (Task 09 requirement). */
export function buildActiveThinkingTurn(
  options?: { item?: CommentaryWorkItemV2 | ReasoningWorkItemV2 } & Partial<CanonicalTurnV2>
): CanonicalTurnV2 {
  const activeItem =
    options?.item ??
    buildReasoning({
      status: 'streaming',
      text: 'Evaluating architectural boundaries and testing infrastructure…',
    });

  const isReasoning = activeItem.type === 'reasoning';
  const detail: 'reasoning' | 'commentary' = isReasoning ? 'reasoning' : 'commentary';
  const currentActivityKind = isReasoning ? 'thinking' : 'commentary';
  const title = isReasoning ? 'Thinking' : 'Generating response';

  const itemStartedAt: string = activeItem.createdAt;

  const currentActivity: CurrentActivityV2 = {
    kind: currentActivityKind,
    subjectId: activeItem.id,
    title,
    text: activeItem.text,
    status: 'streaming',
    startedAt: itemStartedAt,
  };

  const work = options?.work ?? [activeItem];
  const historicalWork =
    options?.historicalWork !== undefined
      ? options.historicalWork
      : work.filter((w) => w.id !== activeItem.id);
  const activityCount = options?.activityCount ?? work.length;

  const { item: _item, ...turnOptions } = options ?? {};

  const status: TurnStatusV2 = {
    status: 'active',
    detail,
    subjectId: activeItem.id,
    since: itemStartedAt,
    source: `${activeItem.type}.started`,
  };

  return buildCanonicalTurn({
    status,
    finalAnswer: null,
    terminalOutcome: undefined,
    ...turnOptions,
    work,
    historicalWork,
    activityCount,
    currentActivity,
  });
}

/** Scenario: Convenience active commentary turn. */
export function buildActiveCommentaryTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  return buildActiveThinkingTurn({
    item: buildCommentary({
      status: 'streaming',
      text: 'Analyzing dependencies and configuration…',
    }),
    ...options,
  });
}

/** Scenario: Fully completed turn with user message, commentary, tools, and final answer. */
export function buildCompletedConversationTurn(options?: Partial<CanonicalTurnV2>): CanonicalTurnV2 {
  const defaultWork: WorkItemV2[] = [
    buildCommentary(),
    buildFileReadTool(),
    buildCommandTool(),
  ];

  const work = options?.work ?? defaultWork;
  const historicalWork = options?.historicalWork ?? work;
  const activityCount = options?.activityCount ?? work.length;

  return buildCanonicalTurn({
    status: {
      status: 'terminal',
      outcome: 'completed',
      initiator: 'agent',
      since: BASE_TIMESTAMP,
      source: 'turn.completed',
    },
    currentActivity: null,
    finalAnswer: buildFinalAnswer(),
    ...options,
    work,
    historicalWork,
    activityCount,
  });
}

/** Scenario: Turn that failed with a terminal error. */
export function buildFailedTurn(
  error = { code: 'COMMAND_EXIT_NONZERO', message: 'Build command failed with exit code 1' },
  options?: Partial<CanonicalTurnV2>
): CanonicalTurnV2 {
  const failedCmd = buildCommandTool({ status: 'failed', exitCode: 1 });
  const work = options?.work ?? [failedCmd];
  const historicalWork = options?.historicalWork ?? work;
  const activityCount = options?.activityCount ?? work.length;

  return buildCanonicalTurn({
    status: { status: 'terminal', outcome: 'failed', initiator: 'agent', error, since: BASE_TIMESTAMP, source: 'turn.failed' },
    currentActivity: null,
    finalAnswer: null,
    terminalOutcome: {
      outcome: 'failed',
      initiator: 'agent',
      error,
      completedAt: BASE_TIMESTAMP,
    },
    ...options,
    work,
    historicalWork,
    activityCount,
  });
}
