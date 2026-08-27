// tools/lib/process.mjs — bounded-output, non-shell asynchronous process runner supporting AbortSignal

import { spawn } from 'node:child_process';

export class ProcessExecutionError extends Error {
  constructor(message, { exitCode = null, signal = null, tail = [] } = {}) {
    super(message);
    this.name = 'ProcessExecutionError';
    this.exitCode = exitCode;
    this.signal = signal;
    this.tail = tail;
  }
}

/**
 * Runs an external process asynchronously with spawn (no shell),
 * capturing a bounded sliding window of output lines to prevent memory exhaustion.
 *
 * @param {string} command Executable binary
 * @param {string[]} args Array of arguments
 * @param {object} options
 * @param {string} [options.cwd] Working directory
 * @param {AbortSignal} [options.signal] AbortSignal for cancellation
 * @param {object} [options.env] Environment variables
 * @param {number} [options.maxTailLines=50] Maximum lines of output to retain
 * @returns {Promise<{ ok: boolean, exitCode: number, tail: string[] }>}
 */
export async function runProcessWithTailAsync(command, args = [], {
  cwd = process.cwd(),
  signal,
  env = process.env,
  maxTailLines = 50,
} = {}) {
  if (signal?.aborted) {
    const error = signal.reason instanceof Error ? signal.reason : new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const spawnOptions = {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    };
    if (signal) {
      spawnOptions.signal = signal;
    }

    let child;
    try {
      child = spawn(command, args, spawnOptions);
    } catch (err) {
      rejectPromise(err);
      return;
    }

    const tailBuffer = [];
    let stdoutRemaining = '';
    let stderrRemaining = '';

    const pushLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      tailBuffer.push(trimmed);
      if (tailBuffer.length > maxTailLines) {
        tailBuffer.shift();
      }
    };

    const processChunk = (chunk, isStderr = false) => {
      const text = chunk.toString('utf8');
      const combined = (isStderr ? stderrRemaining : stdoutRemaining) + text;
      const lines = combined.split(/\r?\n/);
      const remainder = lines.pop() || '';
      if (isStderr) {
        stderrRemaining = remainder;
      } else {
        stdoutRemaining = remainder;
      }
      for (const line of lines) {
        pushLine(line);
      }
    };

    child.stdout?.on('data', chunk => processChunk(chunk, false));
    child.stderr?.on('data', chunk => processChunk(chunk, true));

    child.on('error', (err) => {
      rejectPromise(err);
    });

    child.on('close', (code, procSignal) => {
      if (stdoutRemaining.trim()) pushLine(stdoutRemaining);
      if (stderrRemaining.trim()) pushLine(stderrRemaining);

      if (code === 0) {
        resolvePromise({
          ok: true,
          exitCode: 0,
          tail: tailBuffer,
        });
      } else {
        const tailSummary = tailBuffer.slice(-5).join(' | ');
        const message = `Process '${command}' exited with code ${code ?? 'null'}${procSignal ? ` (signal: ${procSignal})` : ''}: ${tailSummary || 'No output'}`;
        rejectPromise(new ProcessExecutionError(message, {
          exitCode: code,
          signal: procSignal,
          tail: tailBuffer,
        }));
      }
    });
  });
}
