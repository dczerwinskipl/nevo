import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClaudeAgentProvider } from '../ai/claude-adapter.mjs';
import { createClaudeContinuationStore } from '../ai/claude-continuation-store.mjs';
import { executeClaudeHook } from '../ai/claude-hook.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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

test('AskUserQuestion PreToolUse/defer pauses, saves continuation, and resumed turn invokes real hook command and delivers updatedInput', async () => {
  const deferredContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-deferred.json'), 'utf-8');
  const resumedContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-resumed.json'), 'utf-8');

  const deferredLines = deferredContent.split('\n').filter(Boolean);
  const resumedLines = resumedContent.split('\n').filter(Boolean);

  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-test-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });

    let spawnCount = 0;
    let capturedSettingsPath = null;
    const provider = createClaudeAgentProvider({
      cwd: tmpBase,
      continuationStore: store,
      spawnProcess: (exec, args) => {
        spawnCount += 1;
        const settingsIdx = args.indexOf('--settings');
        if (settingsIdx !== -1) {
          capturedSettingsPath = args[settingsIdx + 1];
        }
        if (spawnCount === 1) return createStreamProcess(deferredLines);
        return createStreamProcess(resumedLines);
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
    assert.ok(firstTurn.interaction.id.startsWith('int-'));
    assert.equal(firstTurn.interaction.questions.length, 1);

    // Verify continuation is durably persisted with state=deferred
    const persisted = store.getContinuation('sess-q-1', firstTurn.interaction.id);
    assert.ok(persisted);
    assert.equal(persisted.state, 'deferred');
    assert.equal(persisted.toolName, 'AskUserQuestion');

    // Resume continuation execution under the same logical turn
    const textDeltas = [];
    const respondPromise = provider.respondInteraction({
      turnId: 'turn-q-1',
      providerSessionId: 'sess-q-1',
      interactionId: firstTurn.interaction.id,
      interaction: firstTurn.interaction,
      response: { answers: [{ questionId: 'q-1', value: 'PostgreSQL' }] },
      emitTextDelta: text => textDeltas.push(text),
    });

    // Execute real hook evaluation via executeClaudeHook
    const hookResult = executeClaudeHook({
      session_id: 'sess-q-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: persisted.toolUseId,
      tool_input: persisted.originalToolInput,
    }, { store });

    assert.equal(hookResult.hookSpecificOutput?.hookEventName, 'PreToolUse');
    assert.equal(hookResult.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(hookResult.hookSpecificOutput?.updatedInput?.answers, {
      'Which database provider would you like to use for persistence?': 'PostgreSQL',
    });


    await respondPromise;
    assert.equal(spawnCount, 2);
    assert.ok(textDeltas.some(t => t.includes('PostgreSQL')));

    // Continuation must be consumed
    assert.equal(store.getContinuation('sess-q-1', firstTurn.interaction.id), null);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Native permission prompt PreToolUse/defer requests permission and hook command delivers allow/deny', async () => {
  const permContent = await readFile(join(FIXTURES_DIR, 'permission-prompt-deferred.json'), 'utf-8');
  const permLines = permContent.split('\n').filter(Boolean);

  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-perm-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });

    let spawnCount = 0;
    const provider = createClaudeAgentProvider({
      cwd: tmpBase,
      continuationStore: store,
      spawnProcess: () => {
        spawnCount += 1;
        if (spawnCount === 1) return createStreamProcess(permLines);
        return createStreamProcess([]);
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

    // 1. Resolve allow
    const allowPromise = provider.respondInteraction({
      turnId: 'turn-perm-1',
      providerSessionId: 'sess-perm-1',
      interactionId: turnResult.interaction.id,
      interaction: turnResult.interaction,
      response: { decision: 'allow' },
    });

    const allowDecision = executeClaudeHook({
      session_id: 'sess-perm-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01Bash',
    }, { store });

    assert.deepEqual(allowDecision, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    });
    await allowPromise;

    // 2. Resolve deny on next interaction
    store.saveDeferred({
      providerSessionId: 'sess-perm-1',
      interactionId: 'int-deny-1',
      toolUseId: 'toolu_01Bash',
      toolName: 'Bash',
      originalToolInput: { command: 'rm -rf /' },
    });

    const denyPromise = provider.respondInteraction({
      turnId: 'turn-perm-1',
      providerSessionId: 'sess-perm-1',
      interactionId: 'int-deny-1',
      interaction: { id: 'int-deny-1', kind: 'permission', toolName: 'Bash' },
      response: { decision: 'deny', message: 'Unauthorized command' },
    });

    const denyDecision = executeClaudeHook({
      session_id: 'sess-perm-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01Bash',
    }, { store });

    assert.deepEqual(denyDecision, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Unauthorized command',
      },
    });
    await denyPromise;
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('private Claude continuation survives adapter reconstruction across restart while waitingForUser', async () => {
  const deferredContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-deferred.json'), 'utf-8');
  const deferredLines = deferredContent.split('\n').filter(Boolean);

  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-restart-'));
  try {
    const store1 = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });

    // Instance 1 runs first turn and defers
    const provider1 = createClaudeAgentProvider({
      cwd: tmpBase,
      continuationStore: store1,
      spawnProcess: () => createStreamProcess(deferredLines),
    });

    const firstTurn = await provider1.startTurn({
      turnId: 'turn-restart-1',
      providerSessionId: 'sess-restart-1',
      message: 'Architecture advice',
    });

    assert.equal(firstTurn.isDeferred, true);
    const interactionId = firstTurn.interaction.id;

    // Simulate backend restart: create new store and new adapter instance pointing to same storage
    const store2 = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    const provider2 = createClaudeAgentProvider({
      cwd: tmpBase,
      continuationStore: store2,
      spawnProcess: () => createStreamProcess([]),
    });

    // User answers on new provider instance
    const respondPromise = provider2.respondInteraction({
      turnId: 'turn-restart-1',
      providerSessionId: 'sess-restart-1',
      interactionId,
      interaction: firstTurn.interaction,
      response: { answers: [{ questionId: 'q-1', value: 'SQLite' }] },
    });

    // Hook fires on independent hook execution and restores stored continuation
    const decision = executeClaudeHook({
      session_id: 'sess-restart-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_01AskUserQuestion',
    }, { store: store2 });

    assert.equal(decision.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(decision.hookSpecificOutput?.updatedInput?.answers, {
      'Which database provider would you like to use for persistence?': 'SQLite',
    });

    await respondPromise;
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Crash after user response but before hook consumption: resolution remains and retry succeeds', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-crash-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    store.saveDeferred({
      providerSessionId: 'sess-crash-test',
      interactionId: 'int-crash-1',
      toolUseId: 'toolu_q_crash',
      toolName: 'AskUserQuestion',
      originalToolInput: { questions: [{ question: 'Env?', options: ['Dev', 'Prod'] }] },
    });

    // User answers
    store.resolveResponse({
      providerSessionId: 'sess-crash-test',
      interactionId: 'int-crash-1',
      userResponse: { answers: [{ questionId: 'q-1', value: 'Dev' }] },
    });

    // Simulated crash: Claude resume failed before hook invocation
    // Verify resolution is still on disk
    const onDisk = store.getContinuation('sess-crash-test', 'int-crash-1');
    assert.equal(onDisk.state, 'resolved');

    // Retry resume: hook successfully reads it
    const hookResult = executeClaudeHook({
      session_id: 'sess-crash-test',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_q_crash',
    }, { store });

    assert.equal(hookResult.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(hookResult.hookSpecificOutput?.updatedInput?.answers, {
      'Env?': 'Dev',
    });
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Unrelated PreToolUse tool call does not consume pending AskUserQuestion resolution', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-mismatch-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    store.saveDeferred({
      providerSessionId: 'sess-mismatch',
      interactionId: 'int-mismatch-1',
      toolUseId: 'toolu_q_mismatch',
      toolName: 'AskUserQuestion',
      originalToolInput: { questions: [{ question: 'Color?', options: ['Red'] }] },
    });

    store.resolveResponse({
      providerSessionId: 'sess-mismatch',
      interactionId: 'int-mismatch-1',
      userResponse: { answers: [{ questionId: 'q-1', value: 'Red' }] },
    });

    // An unrelated tool (e.g. ReadFile) fires
    const unrelatedResult = executeClaudeHook({
      session_id: 'sess-mismatch',
      hook_event_name: 'PreToolUse',
      tool_name: 'ReadFile',
      tool_use_id: 'toolu_read_unrelated',
      tool_input: { file_path: 'foo.txt' },
    }, { store });

    assert.equal(unrelatedResult.hookSpecificOutput?.permissionDecision, 'allow');

    // Verify AskUserQuestion resolution was NOT consumed
    const stillPending = store.getContinuation('sess-mismatch', 'int-mismatch-1');
    assert.ok(stillPending);
    assert.equal(stillPending.state, 'resolved');
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Parallel tool batch boundary documents known single-batch limitation (deferral not supported in parallel batch)', async () => {
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
