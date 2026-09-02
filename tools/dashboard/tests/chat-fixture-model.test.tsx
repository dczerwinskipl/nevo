import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildUserMessage,
  buildFinalAnswer,
  buildCommentary,
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
  buildCompletedConversationTurn,
  buildFailedTurn,
  resetFixtureSeq,
  LONG_COMMAND_STRING,
  LONG_PATH_STRING,
  LONG_COMMENTARY_TEXT,
} from '../ui/features/agent-sessions/work-v2/__fixtures__/chat-fixtures.ts';
import { projectTimelineV2 } from '../ui/features/agent-sessions/work-v2/timeline-projection-v2.ts';

describe('Chat Fixture Model (Task 06)', () => {
  beforeEach(() => {
    resetFixtureSeq(1);
  });

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

  describe('Tool builders covering each represented kind and status', () => {
    it('buildCommandTool builds command tool with active, completed, and failed statuses', () => {
      const completed = buildCommandTool();
      expect(completed.type).toBe('tool');
      expect(completed.kind).toBe('command');
      expect(completed.toolName).toBe('run_command');
      expect(completed.title).toBe('Run command');
      expect(completed.status).toBe('completed');
      expect(completed.exitCode).toBe(0);

      const active = buildCommandTool({ status: 'active' });
      expect(active.status).toBe('active');
      expect(active.exitCode).toBeUndefined();
      expect(active.completedAt).toBeUndefined();

      const failed = buildCommandTool({ status: 'failed', exitCode: 127 });
      expect(failed.status).toBe('failed');
      expect(failed.exitCode).toBe(127);
    });

    it('buildFileReadTool builds read tool', () => {
      const tool = buildFileReadTool();
      expect(tool.type).toBe('tool');
      expect(tool.kind).toBe('read');
      expect(tool.toolName).toBe('view_file');
      expect(tool.title).toBe('Read file');
      expect(tool.status).toBe('completed');
    });

    it('buildFileEditTool builds edit tool', () => {
      const tool = buildFileEditTool();
      expect(tool.type).toBe('tool');
      expect(tool.kind).toBe('edit');
      expect(tool.toolName).toBe('replace_file_content');
      expect(tool.title).toBe('Edit file');
      expect(tool.status).toBe('completed');
    });

    it('buildFileWriteTool builds write tool', () => {
      const tool = buildFileWriteTool();
      expect(tool.type).toBe('tool');
      expect(tool.kind).toBe('write');
      expect(tool.toolName).toBe('write_to_file');
      expect(tool.title).toBe('Write file');
      expect(tool.status).toBe('completed');
    });

    it('buildSearchTool builds search tool', () => {
      const tool = buildSearchTool();
      expect(tool.type).toBe('tool');
      expect(tool.kind).toBe('search');
      expect(tool.toolName).toBe('grep_search');
      expect(tool.title).toBe('Search code');
      expect(tool.status).toBe('completed');
    });
  });

  it('buildGroupedCommandsScenario produces items that group under timeline projection', () => {
    const items = buildGroupedCommandsScenario(4);
    expect(items.length).toBe(4);
    for (const item of items) {
      expect(item.kind).toBe('command');
      expect(item.title).toBe('Run command');
      expect(item.status).toBe('completed');
    }

    // Verify canonical timeline projection groups them into a single tool_group row
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

  describe('Canonical turn scenarios', () => {
    it('buildEmptyWaitingTurn produces a waiting turn with no work', () => {
      const turn = buildEmptyWaitingTurn();
      expect(turn.status.status).toBe('waiting');
      expect(turn.work.length).toBe(0);
      expect(turn.activityCount).toBe(0);
      expect(turn.currentActivity).toBeNull();
      expect(turn.finalAnswer).toBeNull();
      expect(turn.terminalOutcome).toBeUndefined();
    });

    it('buildActiveRunningTurn produces an active turn with currentActivity', () => {
      const turn = buildActiveRunningTurn();
      expect(turn.status.status).toBe('active');
      expect(turn.work.length).toBe(1);
      expect(turn.currentActivity).not.toBeNull();
      expect(turn.currentActivity?.kind).toBe('tool');
      expect(turn.currentActivity?.status).toBe('active');
      expect(turn.terminalOutcome).toBeUndefined();
    });

    it('buildCompletedConversationTurn produces a fully terminal completed turn', () => {
      const turn = buildCompletedConversationTurn();
      expect(turn.status.status).toBe('terminal');
      if (turn.status.status === 'terminal') {
        expect(turn.status.outcome).toBe('completed');
      }
      expect(turn.userMessage).toBeDefined();
      expect(turn.work.length).toBeGreaterThanOrEqual(3);
      expect(turn.finalAnswer).not.toBeNull();
      expect(turn.finalAnswer?.status).toBe('completed');
      expect(turn.terminalOutcome?.outcome).toBe('completed');
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
    });
  });
});
