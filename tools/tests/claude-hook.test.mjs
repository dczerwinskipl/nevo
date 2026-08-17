import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeContinuationStore } from '../ai/claude-continuation-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOOK_SCRIPT_PATH = join(__dirname, '..', 'ai', 'claude-hook.mjs');

function runHookSubprocess(inputObject, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_SCRIPT_PATH], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Hook subprocess exited with code ${code}: ${stderr}`));
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : null;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse hook stdout: ${stdout} (${err.message})`));
      }
    });

    child.on('error', reject);
    child.stdin.end(JSON.stringify(inputObject) + '\n');
  });
}

test('Hook subprocess: unconfigured / default tools return allow', async () => {
  const result = await runHookSubprocess({
    session_id: 'sess-test-1',
    hook_event_name: 'PreToolUse',
    tool_name: 'ReadFile',
    tool_input: { file_path: 'foo.txt' },
    tool_use_id: 'toolu_read_1',
  });

  assert.deepEqual(result, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  });
});

test('Hook subprocess: AskUserQuestion without resolved response returns defer', async () => {
  const result = await runHookSubprocess({
    session_id: 'sess-test-q-1',
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Color?', options: ['Red', 'Blue'] }] },
    tool_use_id: 'toolu_q_1',
  });

  assert.deepEqual(result, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'defer',
    },
  });
});

test('Hook subprocess: AskUserQuestion with resolved response maps answers to question text and returns allow + updatedInput', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-hook-test-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    store.saveDeferred({
      providerSessionId: 'sess-q-resolve',
      interactionId: 'int-12345',
      toolUseId: 'toolu_q_99',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [
          { question: 'What database do you prefer?', header: 'DB', options: ['PostgreSQL', 'SQLite'] },
        ],
      },
    });

    store.resolveResponse({
      providerSessionId: 'sess-q-resolve',
      interactionId: 'int-12345',
      userResponse: {
        answers: [{ questionId: 'q-1', value: 'PostgreSQL' }],
      },
    });

    const result = await runHookSubprocess({
      session_id: 'sess-q-resolve',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          { question: 'What database do you prefer?', header: 'DB', options: ['PostgreSQL', 'SQLite'] },
        ],
      },
      tool_use_id: 'toolu_q_99',
    }, { cwd: tmpBase });

    assert.equal(result.hookSpecificOutput?.hookEventName, 'PreToolUse');
    assert.equal(result.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(result.hookSpecificOutput?.updatedInput, {
      questions: [
        { question: 'What database do you prefer?', header: 'DB', options: ['PostgreSQL', 'SQLite'] },
      ],
      answers: {
        'What database do you prefer?': 'PostgreSQL',
      },
    });

    // Continuation marked delivered on disk (not deleted!)
    const remaining = store.getContinuation('sess-q-resolve', 'int-12345');
    assert.ok(remaining);
    assert.equal(remaining.state, 'delivered');
    assert.ok(remaining.deliveredAt);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Hook subprocess: same tool input but mismatched tool_use_id fails correlation and returns defer', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-hook-sameinput-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    const sameInput = { questions: [{ question: 'Which database?', options: ['PostgreSQL', 'SQLite'] }] };

    store.saveDeferred({
      providerSessionId: 'sess-same-input',
      interactionId: 'int-same-1',
      toolUseId: 'tool-A',
      toolName: 'AskUserQuestion',
      toolInput: sameInput,
    });

    store.resolveResponse({
      providerSessionId: 'sess-same-input',
      interactionId: 'int-same-1',
      userResponse: { answers: [{ questionId: 'q-1', value: 'PostgreSQL' }] },
    });

    // Incoming hook has tool_use_id: 'tool-B' with EXACT SAME INPUT
    const result = await runHookSubprocess({
      session_id: 'sess-same-input',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'tool-B',
      tool_input: sameInput,
    }, { cwd: tmpBase });

    // Must return defer for unresolved tool-B because toolUseId does not match!
    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
      },
    });

    // Stored continuation remains in resolved state
    const record = store.getContinuation('sess-same-input', 'int-same-1');
    assert.ok(record);
    assert.equal(record.state, 'resolved');
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Hook subprocess: retry after delivery returns the same decision until parent execution completes', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-hook-retry-delivered-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    const toolInput = { questions: [{ question: 'Deploy env?', options: ['Staging', 'Prod'] }] };

    store.saveDeferred({
      providerSessionId: 'sess-retry-del',
      interactionId: 'int-del-1',
      toolUseId: 'tool-del-1',
      toolName: 'AskUserQuestion',
      toolInput,
    });

    store.resolveResponse({
      providerSessionId: 'sess-retry-del',
      interactionId: 'int-del-1',
      userResponse: { answers: [{ questionId: 'q-1', value: 'Staging' }] },
    });

    // 1st hook invocation: executes and marks delivered
    const result1 = await runHookSubprocess({
      session_id: 'sess-retry-del',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'tool-del-1',
      tool_input: toolInput,
    }, { cwd: tmpBase });

    assert.equal(result1.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(result1.hookSpecificOutput?.updatedInput?.answers, {
      'Deploy env?': 'Staging',
    });

    const recordAfterFirst = store.getContinuation('sess-retry-del', 'int-del-1');
    assert.equal(recordAfterFirst.state, 'delivered');

    // Resumed process fails before completion.
    // 2nd hook invocation (retry): executes again and returns the exact same allow decision
    const result2 = await runHookSubprocess({
      session_id: 'sess-retry-del',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'tool-del-1',
      tool_input: toolInput,
    }, { cwd: tmpBase });

    assert.equal(result2.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(result2.hookSpecificOutput?.updatedInput?.answers, {
      'Deploy env?': 'Staging',
    });

    // Parent completes successfully: cleanup continuation
    store.complete({ providerSessionId: 'sess-retry-del', interactionId: 'int-del-1' });
    assert.equal(store.getContinuation('sess-retry-del', 'int-del-1'), null);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});
