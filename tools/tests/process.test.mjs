import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcessWithTailAsync, ProcessExecutionError } from '../lib/process.mjs';
import { runDotnetCheckAsync } from '../specs/finalize/operation.mjs';

test('runProcessWithTailAsync — spawn-based bounded-output async process runner', async (t) => {
  await t.test('executes successful command and returns exitCode 0 with tail output', async () => {
    const result = await runProcessWithTailAsync(process.execPath, ['-e', 'console.log("hello world");']);
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.tail.includes('hello world'));
  });

  await t.test('captures bounded tail lines without unbounded memory buffering', async () => {
    const script = 'for (let i = 1; i <= 200; i++) console.log("line " + i);';
    const result = await runProcessWithTailAsync(process.execPath, ['-e', script], {
      maxTailLines: 10,
    });
    assert.equal(result.ok, true);
    assert.equal(result.tail.length, 10);
    assert.equal(result.tail[result.tail.length - 1], 'line 200');
    assert.equal(result.tail[0], 'line 191');
  });

  await t.test('rejects with ProcessExecutionError and captures error tail on non-zero exit', async () => {
    await assert.rejects(
      async () => {
        await runProcessWithTailAsync(process.execPath, ['-e', 'console.error("fatal error occurred"); process.exit(42);']);
      },
      (err) => {
        assert.ok(err instanceof ProcessExecutionError);
        assert.equal(err.exitCode, 42);
        assert.ok(err.tail.some(l => l.includes('fatal error occurred')));
        return true;
      },
    );
  });

  await t.test('aborts immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Pre-aborted'));

    await assert.rejects(
      async () => {
        await runProcessWithTailAsync(process.execPath, ['-e', 'setTimeout(() => {}, 5000);'], {
          signal: controller.signal,
        });
      },
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      },
    );
  });

  await t.test('aborts running process when signal is triggered mid-execution', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Timed out')), 50);

    await assert.rejects(
      async () => {
        await runProcessWithTailAsync(process.execPath, ['-e', 'setTimeout(() => {}, 10000);'], {
          signal: controller.signal,
        });
      },
      (err) => {
        clearTimeout(timer);
        assert.equal(err.name, 'AbortError');
        return true;
      },
    );
  });
});

test('runDotnetCheckAsync — handles success, failure diagnostics, and abort signals', async (t) => {
  await t.test('passes with true when command succeeds', async () => {
    // node -v via dotnet stub or valid command; here we test with process.execPath logic or dotnet --version
    const result = await runDotnetCheckAsync('dotnet version', ['--version']);
    assert.equal(result.name, 'dotnet version');
    assert.equal(result.passed, true);
  });

  await t.test('returns passed: false and extracts failure tail on non-zero exit', async () => {
    const result = await runDotnetCheckAsync('invalid build', ['build', 'nonexistent-project.csproj']);
    assert.equal(result.name, 'invalid build');
    assert.equal(result.passed, false);
    assert.ok(typeof result.detail === 'string');
    assert.ok(result.detail.length > 0);
  });

  await t.test('returns passed: false and reports abort message when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Cancelled check'));

    const result = await runDotnetCheckAsync('aborted build', ['build'], {
      signal: controller.signal,
    });
    assert.equal(result.name, 'aborted build');
    assert.equal(result.passed, false);
  });
});
