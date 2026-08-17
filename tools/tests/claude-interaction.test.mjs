import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';

import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClaudeAgentProvider } from '../ai/claude-adapter.mjs';
import { createClaudeContinuationStore } from '../ai/claude-continuation-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, 'fixtures', 'claude');

function createStreamProcess(lines = [], { exitCode = 0, delayMs = 2, onStdin, sessionId } = {}) {
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
    for (const rawLine of lines) {
      if (child.killed) break;
      let line = rawLine;
      if (sessionId) {
        try {
          const parsed = JSON.parse(rawLine);
          if (!parsed.session_id) {
            parsed.session_id = sessionId;
            line = JSON.stringify(parsed);
          }
        } catch {}
      }
      child.stdout.push(`${line}\n`);
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    child.stdout.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

test('AskUserQuestion PreToolUse/defer pauses, saves continuation, and resumed turn delivers updatedInput via hook', async () => {
  const deferredContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-deferred.json'), 'utf-8');
  const resumedContent = await readFile(join(FIXTURES_DIR, 'ask-user-question-resumed.json'), 'utf-8');

  const deferredLines = deferredContent.split('\n').filter(Boolean);
  const resumedLines = resumedContent.split('\n').filter(Boolean);

  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-test-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });

    let spawnCount = 0;
    const provider = createClaudeAgentProvider({
      cwd: tmpBase,
      continuationStore: store,
      spawnProcess: (exec, args) => {
        spawnCount += 1;
        const sIdx = args.indexOf('--session-id') !== -1 ? args.indexOf('--session-id') : args.indexOf('--resume');
        const sid = sIdx !== -1 ? args[sIdx + 1] : undefined;
        if (spawnCount === 1) return createStreamProcess(deferredLines, { sessionId: sid });
        return createStreamProcess(resumedLines, { sessionId: sid });
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

    // Continuation completed and cleaned up after successful resume
    assert.equal(store.getContinuation('sess-q-1', firstTurn.interaction.id), null);
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
      spawnProcess: (exec, args) => {
        const sIdx = args.indexOf('--session-id') !== -1 ? args.indexOf('--session-id') : args.indexOf('--resume');
        return createStreamProcess(deferredLines, { sessionId: args[sIdx + 1] });
      },
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
      spawnProcess: (exec, args) => {
        const sIdx = args.indexOf('--resume');
        return createStreamProcess([], { sessionId: args[sIdx + 1] });
      },
    });

    // User answers on new provider instance
    await provider2.respondInteraction({
      turnId: 'turn-restart-1',
      providerSessionId: 'sess-restart-1',
      interactionId,
      interaction: firstTurn.interaction,
      response: { answers: [{ questionId: 'q-1', value: 'SQLite' }] },
    });

    // Continuation completed cleanly
    assert.equal(store2.getContinuation('sess-restart-1', interactionId), null);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Crash after user response but before resume execution: resolution remains and retry succeeds', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-crash-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    store.saveDeferred({
      providerSessionId: 'sess-crash-test',
      interactionId: 'int-crash-1',
      toolUseId: 'toolu_q_crash',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [{ question: 'Env?', options: ['Dev', 'Prod'] }] },
    });

    let shouldFail = true;
    const provider = createClaudeAgentProvider({
      cwd: tmpBase,
      continuationStore: store,
      spawnProcess: (exec, args) => {
        if (shouldFail) {
          throw new Error('Claude process resume failure simulation');
        }
        const sIdx = args.indexOf('--resume');
        return createStreamProcess([], { sessionId: args[sIdx + 1] });
      },
    });

    // Attempt 1 fails during resume
    await assert.rejects(
      () => provider.respondInteraction({
        turnId: 'turn-crash-1',
        providerSessionId: 'sess-crash-test',
        interactionId: 'int-crash-1',
        interaction: { id: 'int-crash-1', kind: 'question' },
        response: { answers: [{ questionId: 'q-1', value: 'Dev' }] },
      }),
      { name: 'AiError' },
    );

    // Verify continuation is STILL on disk in resolved state (not lost!)
    const onDisk = store.getContinuation('sess-crash-test', 'int-crash-1');
    assert.ok(onDisk);
    assert.equal(onDisk.state, 'resolved');

    // Attempt 2 (retry) succeeds
    shouldFail = false;
    await provider.respondInteraction({
      turnId: 'turn-crash-1',
      providerSessionId: 'sess-crash-test',
      interactionId: 'int-crash-1',
      interaction: { id: 'int-crash-1', kind: 'question' },
      response: { answers: [{ questionId: 'q-1', value: 'Dev' }] },
    });

    // Completed
    assert.equal(store.getContinuation('sess-crash-test', 'int-crash-1'), null);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('parallel tool batch documents limitation: deferral not supported across parallel tools in single batch', async () => {
  const batchContent = await readFile(join(FIXTURES_DIR, 'parallel-tool-batch-deferred.json'), 'utf-8');
  const batchLines = batchContent.split('\n').filter(Boolean);

  const provider = createClaudeAgentProvider({
    spawnProcess: (exec, args) => {
      const sIdx = args.indexOf('--session-id') !== -1 ? args.indexOf('--session-id') : args.indexOf('--resume');
      return createStreamProcess(batchLines, { sessionId: args[sIdx + 1] });
    },
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
});

test('Full integration: adapter -> generated settings -> real claude-hook.mjs subprocess execution', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-claude-full-bridge-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });

    let spawnCount = 0;
    let executedHookOutput = null;

    const provider = createClaudeAgentProvider({
      cwd: tmpBase,
      continuationStore: store,
      spawnProcess: (exec, args) => {
        spawnCount += 1;
        const sIdx = args.indexOf('--session-id') !== -1 ? args.indexOf('--session-id') : args.indexOf('--resume');
        const sid = args[sIdx + 1];

        const settingsIdx = args.indexOf('--settings');
        const settingsPath = args[settingsIdx + 1];

        if (spawnCount === 1) {
          const deferLines = [

            JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'toolu_real_bridge_01',
                name: 'AskUserQuestion',
                input: {
                  questions: [
                    { question: 'Which framework?', header: 'FW', options: ['React', 'Vue'] },
                  ],
                },
              },
            }),
            JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'tool_deferred' },
              deferred_tool_use: {
                id: 'toolu_real_bridge_01',
                name: 'AskUserQuestion',
                input: {
                  questions: [
                    { question: 'Which framework?', header: 'FW', options: ['React', 'Vue'] },
                  ],
                },
              },
            }),
            JSON.stringify({
              type: 'result',
              terminal_reason: 'tool_deferred',
              deferred_tool_use: {
                id: 'toolu_real_bridge_01',
                name: 'AskUserQuestion',
                input: {
                  questions: [
                    { question: 'Which framework?', header: 'FW', options: ['React', 'Vue'] },
                  ],
                },
              },
            }),
          ];
          return createStreamProcess(deferLines, { sessionId: sid });

        } else {
          // Fake Claude reads settings file generated by adapter
          const settingsJson = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          const hookCmd = settingsJson.hooks.PreToolUse[0].hooks[0].command;

          // Fake Claude spawns the command configured in settings as a real OS subprocess
          const child = new EventEmitter();
          child.stdin = new Writable({ write(c, e, cb) { cb(); } });
          child.stdout = new Readable({ read() {} });
          child.stderr = new Readable({ read() {} });
          child.kill = () => { child.emit('close', 0); };

          setImmediate(async () => {
            // Execute real hook subprocess configured in settings
            const parts = hookCmd.match(/(?:[^\s"]+|"[^"]*")+/g).map(p => p.replace(/^"|"$/g, ''));
            const hookProcess = spawn(parts[0], parts.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], cwd: tmpBase });
            let hookStdout = '';

            hookProcess.stdout.on('data', d => { hookStdout += d.toString(); });
            hookProcess.stdin.end(JSON.stringify({
              session_id: sid,
              hook_event_name: 'PreToolUse',
              tool_name: 'AskUserQuestion',
              tool_use_id: 'toolu_real_bridge_01',
              tool_input: {
                questions: [
                  { question: 'Which framework?', header: 'FW', options: ['React', 'Vue'] },
                ],
              },
            }) + '\n');

            await new Promise(r => hookProcess.on('close', r));
            executedHookOutput = JSON.parse(hookStdout.trim());

            // Resumed turn produces output based on hook's decision
            child.stdout.push(`${JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: `Selected: ${executedHookOutput.hookSpecificOutput?.updatedInput?.answers?.['Which framework?']}` },
              session_id: sid,
            })}\n`);
            child.stdout.push(`${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              session_id: sid,
            })}\n`);
            child.stdout.push(null);
            child.emit('close', 0);
          });

          return child;
        }
      },
    });

    // 1. Initial turn defers
    const firstTurn = await provider.startTurn({
      turnId: 'turn-bridge-1',
      providerSessionId: 'sess-bridge-1',
      message: 'Select framework',
    });

    assert.equal(firstTurn.isDeferred, true);
    assert.ok(firstTurn.interaction);

    // 2. User responds
    const textDeltas = [];
    await provider.respondInteraction({
      turnId: 'turn-bridge-1',
      providerSessionId: 'sess-bridge-1',
      interactionId: firstTurn.interaction.id,
      interaction: firstTurn.interaction,
      response: { answers: [{ questionId: 'q-1', value: 'React' }] },
      emitTextDelta: text => textDeltas.push(text),
    });

    // Verify hook subprocess was executed via settings command and delivered decision
    assert.ok(executedHookOutput);
    assert.equal(executedHookOutput.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(executedHookOutput.hookSpecificOutput?.updatedInput?.answers, {
      'Which framework?': 'React',
    });
    assert.ok(textDeltas.some(t => t.includes('React')));

    // Continuation completed and deleted after successful execution
    assert.equal(store.getContinuation('sess-bridge-1', firstTurn.interaction.id), null);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

