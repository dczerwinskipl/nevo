import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeAgentProvider } from '../ai/claude-adapter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'claude');

function createStreamProcess(lines = [], { exitCode = 0, delayMs = 2, onStdin } = {}) {
  const child = new EventEmitter();
  let stdinContent = '';
  child.stdin = new Writable({
    write(c, e, cb) {
      stdinContent += c.toString();
      if (onStdin) onStdin(c.toString());
      cb();
    },
  });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit('close', 0));
  };
  child.getStdin = () => stdinContent;

  setImmediate(async () => {
    for (const line of lines) {
      if (child.killed) break;
      child.stdout.push(`${line}\n`);
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    child.stdout.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

test('AskUserQuestion PreToolUse/defer parses questions and resumed turn delivers updatedInput tool_result', async () => {
  const deferredContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-deferred.json'), 'utf-8');
  const resumedContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-resumed.json'), 'utf-8');

  const deferredLines = deferredContent.split('\n').filter(Boolean);
  const resumedLines = resumedContent.split('\n').filter(Boolean);

  let spawnCount = 0;
  let resumedStdin = '';
  const provider = createClaudeAgentProvider({
    spawnProcess: () => {
      spawnCount += 1;
      if (spawnCount === 1) return createStreamProcess(deferredLines);
      return createStreamProcess(resumedLines, {
        onStdin: data => { resumedStdin += data; },
      });
    },
  });

  const toolCalls = [];
  const reasoningDeltas = [];

  const firstTurn = await provider.startTurn({
    turnId: 'turn-q-1',
    providerSessionId: 'sess-q-1',
    message: 'Architecture advice',
    emitReasoningDelta: text => reasoningDeltas.push(text),
    emitToolStarted: tool => toolCalls.push(tool),
  });

  assert.equal(spawnCount, 1);
  assert.equal(firstTurn.isDeferred, true);
  assert.ok(firstTurn.interaction);
  assert.equal(firstTurn.interaction.kind, 'question');
  assert.equal(firstTurn.interaction.questions.length, 1);
  assert.equal(firstTurn.interaction.questions[0].options?.length, 2);
  assert.equal(reasoningDeltas.length > 0, true);

  // Resume continuation execution under the same logical turn
  const textDeltas = [];
  await provider.respondInteraction({
    turnId: 'turn-q-1',
    providerSessionId: 'sess-q-1',
    interactionId: firstTurn.interaction.id,
    interaction: firstTurn.interaction,
    response: { answers: [{ questionId: 'q-1', value: 'PostgreSQL' }] },
    emitTextDelta: text => textDeltas.push(text),
  });

  assert.equal(spawnCount, 2);
  assert.ok(textDeltas.some(t => t.includes('PostgreSQL')));

  // Verify exact tool_result payload written to stdin
  const parsedStdin = JSON.parse(resumedStdin.trim());
  assert.equal(parsedStdin.type, 'tool_result');
  assert.equal(parsedStdin.tool_use_id, firstTurn.interaction.id);
  assert.equal(parsedStdin.permissionDecision, 'allow');
  assert.deepEqual(parsedStdin.updatedInput.answers, [{ questionId: 'q-1', value: 'PostgreSQL' }]);
});

test('Native permission prompt PreToolUse/defer requests permission and delivers allow/deny tool_result', async () => {
  const permContent = await readFile(join(FIXTURES_DIR, 'permission-prompt-deferred.json'), 'utf-8');
  const permLines = permContent.split('\n').filter(Boolean);

  let spawnCount = 0;
  let resumedStdin = '';
  const provider = createClaudeAgentProvider({
    spawnProcess: () => {
      spawnCount += 1;
      if (spawnCount === 1) return createStreamProcess(permLines);
      return createStreamProcess([], {
        onStdin: data => { resumedStdin += data; },
      });
    },
  });

  const turnResult = await provider.startTurn({
    turnId: 'turn-perm-1',
    providerSessionId: 'sess-perm-1',
    message: 'Run build',
  });


  assert.equal(turnResult.isDeferred, true);
  assert.ok(turnResult.interaction);
  assert.equal(turnResult.interaction.kind, 'permission');
  assert.equal(turnResult.interaction.toolName, 'Bash');
  assert.equal(turnResult.interaction.input.command, 'npm --prefix tools/dashboard run build');

  // 1. Resolve allow
  await provider.respondInteraction({
    turnId: 'turn-perm-1',
    providerSessionId: 'sess-perm-1',
    interactionId: turnResult.interaction.id,
    interaction: turnResult.interaction,
    response: { decision: 'allow' },
  });

  const parsedAllow = JSON.parse(resumedStdin.trim());
  assert.equal(parsedAllow.type, 'tool_result');
  assert.equal(parsedAllow.permissionDecision, 'allow');
  assert.equal(parsedAllow.tool_use_id, turnResult.interaction.id);

  // 2. Resolve deny
  resumedStdin = '';
  await provider.respondInteraction({
    turnId: 'turn-perm-1',
    providerSessionId: 'sess-perm-1',
    interactionId: turnResult.interaction.id,
    interaction: turnResult.interaction,
    response: { decision: 'deny', message: 'Unauthorized command' },
  });

  const parsedDeny = JSON.parse(resumedStdin.trim());
  assert.equal(parsedDeny.type, 'tool_result');
  assert.equal(parsedDeny.permissionDecision, 'deny');
  assert.equal(parsedDeny.tool_use_id, turnResult.interaction.id);
  assert.equal(parsedDeny.message, 'Unauthorized command');
});

test('Parallel tool batch boundary handles deferral of interactive tool in batch', async () => {
  const batchContent = await readFile(join(FIXTURES_DIR, 'parallel-tool-batch-deferred.json'), 'utf-8');
  const batchLines = batchContent.split('\n').filter(Boolean);

  const provider = createClaudeAgentProvider({
    spawnProcess: () => createStreamProcess(batchLines),
  });

  const toolsStarted = [];
  const turnResult = await provider.startTurn({
    turnId: 'turn-batch-1',
    providerSessionId: 'sess-batch-1',
    message: 'Parallel test',
    emitToolStarted: tool => toolsStarted.push(tool),
  });

  assert.equal(toolsStarted.length, 2);
  assert.equal(toolsStarted[0].toolName, 'ReadFile');
  assert.equal(toolsStarted[1].toolName, 'AskUserQuestion');
  assert.equal(turnResult.isDeferred, true);
  assert.ok(turnResult.interaction);
  assert.equal(turnResult.interaction.kind, 'question');
});
