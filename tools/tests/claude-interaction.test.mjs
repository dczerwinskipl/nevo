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

function createStreamProcess(lines = [], { exitCode = 0, delayMs = 2 } = {}) {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(c, e, cb) { cb(); } });
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit('close', 0));
  };

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

test('AskUserQuestion PreToolUse/defer pauses, captures questions, and completes after user response', async () => {
  const deferredContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-deferred.json'), 'utf-8');
  const resumedContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-resumed.json'), 'utf-8');

  const deferredLines = deferredContent.split('\n').filter(Boolean);
  const resumedLines = resumedContent.split('\n').filter(Boolean);

  let spawnCount = 0;
  const provider = createClaudeAgentProvider({
    spawnProcess: () => {
      spawnCount += 1;
      if (spawnCount === 1) return createStreamProcess(deferredLines);
      return createStreamProcess(resumedLines);
    },
  });

  let requestedInteraction = null;
  const toolCalls = [];
  const reasoningDeltas = [];

  const firstTurn = await provider.startTurn({
    turnId: 'turn-q-1',
    providerSessionId: 'sess-q-1',
    message: 'Architecture advice',
    emitReasoningDelta: text => reasoningDeltas.push(text),
    emitToolStarted: tool => toolCalls.push(tool),
    requestInteraction: async interaction => {
      requestedInteraction = interaction;
      return { answers: [{ questionId: 'q-1', value: 'PostgreSQL' }] };
    },
  });

  assert.equal(spawnCount, 1);
  assert.ok(requestedInteraction);
  assert.equal(requestedInteraction.kind, 'question');
  assert.equal(requestedInteraction.questions.length, 1);
  assert.equal(requestedInteraction.questions[0].options?.length, 2);
  assert.equal(reasoningDeltas.length > 0, true);

  // Resume turn with user answers
  const resumeResult = await provider.respondInteraction(
    { provider: 'claude', providerSessionId: 'sess-q-1' },
    { answers: [{ questionId: 'q-1', value: 'PostgreSQL' }] }
  );
  assert.equal(resumeResult.resumed, true);

  const textDeltas = [];
  await provider.startTurn({
    turnId: 'turn-q-2',
    providerSessionId: 'sess-q-1',
    message: 'User selected PostgreSQL',
    emitTextDelta: text => textDeltas.push(text),
  });

  assert.equal(spawnCount, 2);
  assert.ok(textDeltas.some(t => t.includes('PostgreSQL')));
});

test('Native permission prompt PreToolUse/defer requests permission and resolves', async () => {
  const permContent = await readFile(join(FIXTURES_DIR, 'permission-prompt-deferred.json'), 'utf-8');
  const permLines = permContent.split('\n').filter(Boolean);

  const provider = createClaudeAgentProvider({
    spawnProcess: () => createStreamProcess(permLines),
  });

  let requestedPermission = null;
  const turnResult = await provider.startTurn({
    turnId: 'turn-perm-1',
    providerSessionId: 'sess-perm-1',
    message: 'Run build',
    requestInteraction: async interaction => {
      requestedPermission = interaction;
      return { decision: 'allow' };
    },
  });

  assert.ok(requestedPermission);
  assert.equal(requestedPermission.kind, 'permission');
  assert.equal(requestedPermission.toolName, 'Bash');
  assert.equal(requestedPermission.input.command, 'npm --prefix tools/dashboard run build');
  assert.deepEqual(turnResult.interactionResult, { decision: 'allow' });
});

test('Parallel tool batch boundary handles deferral of interactive tool in batch', async () => {
  const batchContent = await readFile(join(FIXTURES_DIR, 'parallel-tool-batch-deferred.json'), 'utf-8');
  const batchLines = batchContent.split('\n').filter(Boolean);

  const provider = createClaudeAgentProvider({
    spawnProcess: () => createStreamProcess(batchLines),
  });

  const toolsStarted = [];
  let interactionRequested = null;

  await provider.startTurn({
    turnId: 'turn-batch-1',
    providerSessionId: 'sess-batch-1',
    message: 'Parallel test',
    emitToolStarted: tool => toolsStarted.push(tool),
    requestInteraction: async interaction => {
      interactionRequested = interaction;
      return { answers: [{ questionId: 'q-1', value: 'Yes' }] };
    },
  });

  assert.equal(toolsStarted.length, 2);
  assert.equal(toolsStarted[0].toolName, 'ReadFile');
  assert.equal(toolsStarted[1].toolName, 'AskUserQuestion');
  assert.ok(interactionRequested);
  assert.equal(interactionRequested.kind, 'question');
});
