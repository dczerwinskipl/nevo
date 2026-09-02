import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolInvocationWorkItemV2, ToolKindV2, ToolStatusV2 } from '../ui/features/agent-sessions/types.ts';
import {
  buildUserMessage,
  buildFinalAnswer,
  buildCommentary,
  buildReasoning,
  buildCommandTool,
  buildFileReadTool,
  buildFileEditTool,
  buildFileWriteTool,
  buildSearchTool,
  buildGroupedCommandsScenario,
  buildLongCommandTool,
  buildLongPathTool,
  buildLongCommentary,
  buildCanonicalTurn,
  buildEmptyWaitingTurn,
  buildActiveRunningTurn,
  buildActiveThinkingTurn,
  buildActiveCommentaryTurn,
  buildCompletedConversationTurn,
  buildFailedTurn,
  resetFixtureSeq,
  type ToolOverrideOptions,
  LONG_COMMAND_STRING,
  LONG_PATH_STRING,
  LONG_COMMENTARY_TEXT,
} from '../ui/features/agent-sessions/work-v2/__fixtures__/chat-fixtures.ts';
import { projectTimelineV2 } from '../ui/features/agent-sessions/work-v2/timeline-projection-v2.ts';

interface ToolMatrixEntry {
  kind: ToolKindV2;
  toolName: string;
  title: string;
  builder: (options?: ToolOverrideOptions) => ToolInvocationWorkItemV2;
  successSnippet: string;
  failureSnippet: string;
}

const TOOL_KIND_MATRIX: ToolMatrixEntry[] = [
  {
    kind: 'command',
    toolName: 'run_command',
    title: 'Run command',
    builder: buildCommandTool,
    successSnippet: 'PASS',
    failureSnippet: 'failed',
  },
  {
    kind: 'read',
    toolName: 'view_file',
    title: 'Read file',
    builder: buildFileReadTool,
    successSnippet: ':root',
    failureSnippet: 'ENOENT',
  },
  {
    kind: 'edit',
    toolName: 'replace_file_content',
    title: 'Edit file',
    builder: buildFileEditTool,
    successSnippet: 'Replacement applied',
    failureSnippet: 'not found',
  },
  {
    kind: 'write',
    toolName: 'write_to_file',
    title: 'Write file',
    builder: buildFileWriteTool,
    successSnippet: 'Created file',
    failureSnippet: 'permission denied',
  },
  {
    kind: 'search',
    toolName: 'grep_search',
    title: 'Search code',
    builder: buildSearchTool,
    successSnippet: 'matches',
    failureSnippet: 'syntax error',
  },
];

describe('Chat Fixture Model (Task 06)', () => {
  beforeEach(() => {
    resetFixtureSeq(1);
  });

  describe('User Message & Final Answer builders', () => {
    it('buildUserMessage returns a valid user message structure', () => {
      const msg = buildUserMessage();
      expect(msg.text).toBeTruthy();
      expect(typeof msg.text).toBe('string');
      expect(msg.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const custom = buildUserMessage({ text: 'Custom query', createdAt: '2026-09-02T15:00:00Z' });
      expect(custom.text).toBe('Custom query');
      expect(custom.createdAt).toBe('2026-09-02T15:00:00Z');
    });

    it('buildFinalAnswer returns a conforming FinalAnswerV2', () => {
      const answer = buildFinalAnswer();
      expect(answer.id).toMatch(/^final-ans-\d+/);
      expect(answer.status).toBe('completed');
      expect(typeof answer.text).toBe('string');
      expect(answer.completedAt).toBeDefined();

      const pending = buildFinalAnswer({ status: 'streaming', text: 'Streaming in progress…' });
      expect(pending.status).toBe('streaming');
      expect(pending.completedAt).toBeUndefined();
    });
  });

  describe('Commentary & Reasoning builders', () => {
    it('buildCommentary returns a conforming CommentaryWorkItemV2', () => {
      const commentary = buildCommentary();
      expect(commentary.type).toBe('commentary');
      expect(commentary.status).toBe('completed');
      expect(typeof commentary.text).toBe('string');
      expect(commentary.completedAt).toBeDefined();

      const streaming = buildCommentary({ status: 'streaming', text: 'Thinking…' });
      expect(streaming.status).toBe('streaming');
      expect(streaming.completedAt).toBeUndefined();
    });

    it('buildReasoning returns a conforming ReasoningWorkItemV2', () => {
      const reasoning = buildReasoning();
      expect(reasoning.type).toBe('reasoning');
      expect(reasoning.status).toBe('completed');
      expect(reasoning.representation).toBe('summary');
      expect(typeof reasoning.text).toBe('string');
      expect(reasoning.completedAt).toBeDefined();

      const streaming = buildReasoning({ status: 'streaming', text: 'Analyzing trade-offs…' });
      expect(streaming.status).toBe('streaming');
      expect(streaming.completedAt).toBeUndefined();
    });
  });

  describe('Table-driven tool lifecycle matrix (active, completed, failed)', () => {
    for (const entry of TOOL_KIND_MATRIX) {
      describe(`Tool: ${entry.kind} (${entry.toolName})`, () => {
        it('active state: lifecycle fields and empty output semantics', () => {
          const tool = entry.builder({ status: 'active' });
          expect(tool.status).toBe('active');
          expect(tool.kind).toBe(entry.kind);
          expect(tool.toolName).toBe(entry.toolName);
          expect(tool.title).toBe(entry.title);
          expect(tool.startedAt).toBeDefined();
          expect(tool.completedAt).toBeUndefined();
          expect(tool.durationMs).toBeUndefined();
          expect(tool.exitCode).toBeUndefined();
          expect(tool.output).toBeUndefined();
        });

        it('completed state: successful output and completed lifecycle fields', () => {
          const tool = entry.builder({ status: 'completed' });
          expect(tool.status).toBe('completed');
          expect(tool.kind).toBe(entry.kind);
          expect(tool.toolName).toBe(entry.toolName);
          expect(tool.title).toBe(entry.title);
          expect(tool.startedAt).toBeDefined();
          expect(tool.completedAt).toBeDefined();
          expect(tool.durationMs).toBe(240);
          expect(String(tool.output)).toContain(entry.successSnippet);

          if (entry.kind === 'command') {
            expect(tool.exitCode).toBe(0);
          } else {
            expect(tool.exitCode).toBeUndefined();
          }
        });

        it('failed state: failure output, no successful output, and terminal lifecycle fields', () => {
          const tool = entry.builder({ status: 'failed' });
          expect(tool.status).toBe('failed');
          expect(tool.kind).toBe(entry.kind);
          expect(tool.toolName).toBe(entry.toolName);
          expect(tool.title).toBe(entry.title);
          expect(tool.startedAt).toBeDefined();
          expect(tool.completedAt).toBeDefined();
          expect(tool.durationMs).toBe(240);
          expect(String(tool.output)).toContain(entry.failureSnippet);
          expect(String(tool.output)).not.toContain(entry.successSnippet);

          if (entry.kind === 'command') {
            expect(tool.exitCode).toBe(1);
          } else {
            expect(tool.exitCode).toBeUndefined();
          }
        });

        it('invariant protection: cannot replace kind, toolName, or title via spread', () => {
          const corrupted = entry.builder({
            ...({ kind: 'other', toolName: 'corrupted_tool', title: 'Corrupted' } as any),
          });
          expect(corrupted.kind).toBe(entry.kind);
          expect(corrupted.toolName).toBe(entry.toolName);
          expect(corrupted.title).toBe(entry.title);
        });

        it('custom exitCode is honored if explicitly provided', () => {
          const tool = entry.builder({ exitCode: 42 });
          expect(tool.exitCode).toBe(42);
        });
      });
    }
  });

  it('buildGroupedCommandsScenario produces items that group under timeline projection', () => {
    const items = buildGroupedCommandsScenario(4);
    expect(items.length).toBe(4);
    for (const item of items) {
      expect(item.kind).toBe('command');
      expect(item.title).toBe('Run command');
      expect(item.status).toBe('completed');
    }

    const projected = projectTimelineV2(items);
    expect(projected.allRows.length).toBe(1);
    expect(projected.allRows[0].row).toBe('tool_group');
    if (projected.allRows[0].row === 'tool_group') {
      expect(projected.allRows[0].count).toBe(4);
      expect(projected.allRows[0].items.length).toBe(4);
    }
  });

  describe('Long content builders (AC2)', () => {
    it('buildLongCommandTool produces long command string (>200 chars)', () => {
      const tool = buildLongCommandTool();
      expect(LONG_COMMAND_STRING.length).toBeGreaterThan(200);
      expect(tool.description).toBe(LONG_COMMAND_STRING);
      expect(tool.description!.length).toBeGreaterThan(200);
      expect(String(tool.output)).toContain('Executed command successfully');
    });

    it('buildLongCommandTool does not retain successful output when active or failed', () => {
      const activeTool = buildLongCommandTool({ status: 'active' });
      expect(activeTool.status).toBe('active');
      expect(activeTool.output).toBeUndefined();
      expect(activeTool.completedAt).toBeUndefined();

      const failedTool = buildLongCommandTool({ status: 'failed' });
      expect(failedTool.status).toBe('failed');
      expect(failedTool.output).toBeDefined();
      expect(String(failedTool.output)).toContain('Command failed with error');
      expect(String(failedTool.output)).not.toContain('Executed command successfully');
    });

    it('buildLongPathTool produces long path string (>100 chars)', () => {
      const tool = buildLongPathTool();
      expect(LONG_PATH_STRING.length).toBeGreaterThan(100);
      expect(tool.description).toBe(LONG_PATH_STRING);
      expect(tool.description!.length).toBeGreaterThan(100);
    });

    it('buildLongCommentary produces multi-paragraph text (>200 chars)', () => {
      const commentary = buildLongCommentary();
      expect(LONG_COMMENTARY_TEXT.length).toBeGreaterThan(200);
      expect(commentary.text).toBe(LONG_COMMENTARY_TEXT);
      expect(commentary.text.length).toBeGreaterThan(200);
    });
  });

  describe('Active commentary & thinking Turn scenario builder (Item 3)', () => {
    it('buildActiveThinkingTurn creates active reasoning turn with canonical evidence', () => {
      const reasoningItem = buildReasoning({ status: 'streaming', text: 'Analyzing model weights…' });
      const turn = buildActiveThinkingTurn({ item: reasoningItem });

      // Active TurnStatusV2 detail matches reasoning
      expect(turn.status.status).toBe('active');
      if (turn.status.status === 'active') {
        expect(turn.status.detail).toBe('reasoning');
        expect(turn.status.subjectId).toBe(reasoningItem.id);
      }

      // Canonical evidence in work
      expect(turn.work).toContain(reasoningItem);
      expect(turn.activityCount).toBe(1);

      // Active item is kept OUT of historicalWork
      expect(turn.historicalWork).not.toContain(reasoningItem);
      expect(turn.historicalWork.length).toBe(0);

      // currentActivity derived from the active item
      expect(turn.currentActivity).not.toBeNull();
      expect(turn.currentActivity?.kind).toBe('thinking');
      expect(turn.currentActivity?.title).toBe('Thinking');
      expect(turn.currentActivity?.text).toBe('Analyzing model weights…');
      expect(turn.currentActivity?.status).toBe('streaming');
      expect(turn.currentActivity?.subjectId).toBe(reasoningItem.id);

      // No final answer or terminal outcome
      expect(turn.finalAnswer).toBeNull();
      expect(turn.terminalOutcome).toBeUndefined();
    });

    it('buildActiveCommentaryTurn creates active commentary turn with Generating response title', () => {
      const turn = buildActiveCommentaryTurn();

      expect(turn.status.status).toBe('active');
      if (turn.status.status === 'active') {
        expect(turn.status.detail).toBe('commentary');
      }

      expect(turn.work.length).toBe(1);
      expect(turn.work[0].type).toBe('commentary');
      expect(turn.historicalWork.length).toBe(0);

      expect(turn.currentActivity?.kind).toBe('commentary');
      expect(turn.currentActivity?.title).toBe('Generating response');
      expect(turn.currentActivity?.status).toBe('streaming');

      expect(turn.finalAnswer).toBeNull();
      expect(turn.terminalOutcome).toBeUndefined();
    });
  });

  describe('Activity override coherence (Item 4)', () => {
    it('buildCompletedConversationTurn synchronizes historicalWork and activityCount when work is overridden', () => {
      const customWork = [
        buildSearchTool({ subject: 'custom-search' }),
        buildFileEditTool({ subject: 'custom-edit.ts' }),
      ];

      const turn = buildCompletedConversationTurn({ work: customWork });

      expect(turn.work).toEqual(customWork);
      expect(turn.historicalWork).toEqual(customWork);
      expect(turn.activityCount).toBe(2);

      // Verify no stale default commentary or command items remain
      expect(turn.historicalWork.some((item) => item.type === 'commentary')).toBe(false);
      expect(turn.historicalWork.some((item) => 'kind' in item && item.kind === 'command')).toBe(false);
    });

    it('buildCanonicalTurn derives historicalWork from custom work', () => {
      const customWork = [buildFileWriteTool()];
      const turn = buildCanonicalTurn({ work: customWork });

      expect(turn.work).toEqual(customWork);
      expect(turn.historicalWork).toEqual(customWork);
      expect(turn.activityCount).toBe(1);
    });
  });

  describe('Canonical turn scenarios', () => {
    it('buildEmptyWaitingTurn produces a waiting turn matching canonical server projection', () => {
      const turn = buildEmptyWaitingTurn();
      expect(turn.status.status).toBe('waiting');
      if (turn.status.status === 'waiting') {
        expect(turn.status.reason).toBe('provider_response');
        expect(turn.status.since).toBeDefined();
      }
      expect(turn.work.length).toBe(0);
      expect(turn.historicalWork.length).toBe(0);
      expect(turn.activityCount).toBe(0);
      expect(turn.finalAnswer).toBeNull();
      expect(turn.terminalOutcome).toBeUndefined();

      // CurrentActivity must be waiting_for_model, title 'Waiting for model response', not 'Thinking'
      expect(turn.currentActivity).not.toBeNull();
      expect(turn.currentActivity?.kind).toBe('waiting_for_model');
      expect(turn.currentActivity?.title).toBe('Waiting for model response');
      expect(turn.currentActivity?.title).not.toBe('Thinking');
      expect(turn.currentActivity?.status).toBe('running');
      expect(turn.currentActivity?.startedAt).toBeDefined();
    });

    it('buildActiveRunningTurn produces an active turn with currentActivity', () => {
      const turn = buildActiveRunningTurn();
      expect(turn.status.status).toBe('active');
      expect(turn.work.length).toBe(1);
      expect(turn.currentActivity).not.toBeNull();
      expect(turn.currentActivity?.kind).toBe('tool');
      expect(turn.currentActivity?.status).toBe('active');
      expect(turn.historicalWork.length).toBe(0);
      expect(turn.terminalOutcome).toBeUndefined();
    });

    it('buildActiveRunningTurn derives all activity fields from supplied active tool without command/read mismatch', () => {
      const activeReadTool = buildFileReadTool({ status: 'active' });
      const turn = buildActiveRunningTurn({ work: [activeReadTool] });

      expect(turn.currentActivity).not.toBeNull();
      expect(turn.currentActivity?.kind).toBe('tool');
      expect(turn.currentActivity?.toolKind).toBe('read');
      expect(turn.currentActivity?.toolName).toBe('view_file');
      expect(turn.currentActivity?.title).toBe('Read file');
      expect(turn.currentActivity?.subject).toBe('index.css');
      expect(turn.currentActivity?.description).toBe('tools/dashboard/ui/index.css');
      expect(turn.currentActivity?.subjectId).toBe(activeReadTool.id);
      expect(turn.currentActivity?.startedAt).toBe(activeReadTool.startedAt);

      expect(turn.status.status).toBe('active');
      if (turn.status.status === 'active') {
        expect(turn.status.subjectId).toBe(activeReadTool.id);
        expect(turn.status.since).toBe(activeReadTool.startedAt);
      }
    });

    it('buildActiveRunningTurn derives currentActivity from the active tool when preceded by completed tools', () => {
      const completedCommand = buildCommandTool({ status: 'completed' });
      const activeReadTool = buildFileReadTool({ status: 'active' });
      const turn = buildActiveRunningTurn({ work: [completedCommand, activeReadTool] });

      expect(turn.currentActivity).not.toBeNull();
      expect(turn.currentActivity?.kind).toBe('tool');
      expect(turn.currentActivity?.toolKind).toBe('read');
      expect(turn.currentActivity?.toolName).toBe('view_file');
      expect(turn.currentActivity?.title).toBe('Read file');
      expect(turn.currentActivity?.subject).toBe('index.css');
      expect(turn.currentActivity?.subjectId).toBe(activeReadTool.id);
      expect(turn.currentActivity?.status).toBe('active');

      // historicalWork must keep the completed command and exclude the active tool
      expect(turn.historicalWork.length).toBe(1);
      expect(turn.historicalWork[0].id).toBe(completedCommand.id);
      expect(turn.historicalWork.some((w) => w.id === activeReadTool.id)).toBe(false);

      expect(turn.work.length).toBe(2);
      expect(turn.activityCount).toBe(2);
    });

    it('buildFailedTurn produces a terminal failed turn with error details', () => {
      const error = { code: 'EXEC_TIMEOUT', message: 'Command timed out after 30000ms' };
      const turn = buildFailedTurn(error);
      expect(turn.status.status).toBe('terminal');
      if (turn.status.status === 'terminal') {
        expect(turn.status.outcome).toBe('failed');
        expect(turn.status.error).toEqual(error);
      }
      expect(turn.terminalOutcome?.outcome).toBe('failed');
      expect(turn.terminalOutcome?.error).toEqual(error);
      expect(turn.historicalWork.length).toBe(1);
      expect(turn.activityCount).toBe(1);
    });
  });
});
