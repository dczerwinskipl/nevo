import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeInteraction, validateAgentEvent } from '../ai/contracts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'claude');

function parseSemver(versionStr) {
  const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function satisfiesMinVersion(versionStr, minStr = '2.1.89') {
  const current = parseSemver(versionStr);
  const min = parseSemver(minStr);
  if (!current || !min) return false;
  if (current.major !== min.major) return current.major > min.major;
  if (current.minor !== min.minor) return current.minor > min.minor;
  return current.patch >= min.patch;
}

function parseStreamJson(content) {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('claude version requirement parser correctly enforces min version >= 2.1.89', () => {
  assert.equal(satisfiesMinVersion('2.1.220 (Claude Code)'), true);
  assert.equal(satisfiesMinVersion('2.1.89'), true);
  assert.equal(satisfiesMinVersion('2.1.90'), true);
  assert.equal(satisfiesMinVersion('2.2.0'), true);
  assert.equal(satisfiesMinVersion('2.1.88'), false);
  assert.equal(satisfiesMinVersion('2.0.100'), false);
  assert.equal(satisfiesMinVersion('invalid'), false);
});

test('AskUserQuestion deferred fixture extracts and maps to normalized question interaction', async () => {
  const content = await readFile(join(FIXTURES_DIR, 'ask-user-question-deferred.json'), 'utf-8');
  const events = parseStreamJson(content);

  const deltaEvent = events.find(e => e.type === 'message_delta' && e.delta?.stop_reason === 'tool_deferred');
  assert.ok(deltaEvent, 'Found tool_deferred message_delta');
  assert.equal(deltaEvent.deferred_tool_use.name, 'AskUserQuestion');

  const rawQuestions = deltaEvent.deferred_tool_use.input.questions;
  assert.equal(rawQuestions.length, 1);

  const normalized = normalizeInteraction({
    id: deltaEvent.deferred_tool_use.id,
    kind: 'question',
    questions: rawQuestions.map((q, idx) => ({
      id: `q-${idx + 1}`,
      question: q.question,
      header: q.header,
      options: q.options,
      multiSelect: q.multiSelect,
    })),
  });

  assert.equal(normalized.kind, 'question');
  assert.equal(normalized.questions.length, 1);
  assert.equal(normalized.questions[0].question, 'Which database provider would you like to use for persistence?');
  assert.equal(normalized.questions[0].options?.length, 2);
});

test('AskUserQuestion resumed fixture streams text deltas and completes turn', async () => {
  const content = await readFile(join(FIXTURES_DIR, 'ask-user-question-resumed.json'), 'utf-8');
  const events = parseStreamJson(content);

  const textBlocks = events.filter(e => e.type === 'content_block_start' && e.content_block?.type === 'text');
  assert.ok(textBlocks.length > 0);

  const deltas = events.filter(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta');
  assert.ok(deltas.length > 0);

  const completion = events.find(e => e.type === 'message_delta' && e.delta?.stop_reason === 'end_turn');
  assert.ok(completion);
});

test('native permission prompt deferred fixture maps to normalized permission interaction', async () => {
  const content = await readFile(join(FIXTURES_DIR, 'permission-prompt-deferred.json'), 'utf-8');
  const events = parseStreamJson(content);

  const deltaEvent = events.find(e => e.type === 'message_delta' && e.delta?.stop_reason === 'tool_deferred');
  assert.ok(deltaEvent);
  assert.equal(deltaEvent.deferred_tool_use.name, 'Bash');

  const normalized = normalizeInteraction({
    id: deltaEvent.deferred_tool_use.id,
    kind: 'permission',
    toolName: deltaEvent.deferred_tool_use.name,
    input: deltaEvent.deferred_tool_use.input,
  });

  assert.equal(normalized.kind, 'permission');
  assert.equal(normalized.toolName, 'Bash');
  assert.equal(normalized.input.command, 'npm --prefix tools/dashboard run build');
});

test('parallel tool batch fixture documents and handles known single-batch limitation', async () => {
  const content = await readFile(join(FIXTURES_DIR, 'parallel-tool-batch-deferred.json'), 'utf-8');
  const events = parseStreamJson(content);

  const toolUseBlocks = events.filter(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
  assert.equal(toolUseBlocks.length, 2);

  const endTurnDelta = events.find(e => e.type === 'message_delta' && e.delta?.stop_reason === 'end_turn');
  assert.ok(endTurnDelta);

  const deferredDelta = events.find(e => e.type === 'message_delta' && e.delta?.stop_reason === 'tool_deferred');
  assert.equal(deferredDelta, undefined, 'Parallel tool batch does not produce tool_deferred stop reason');
});

