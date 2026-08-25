import { existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { ROOT } from '../store.mjs';
import { verifyTask } from '../operations/index.mjs';
import { createProgressEmitter } from '../../lib/operation-progress.mjs';
import { splitShellWords } from '../../lib/shell-words.mjs';

export function runVerificationCommand(commandString) {
  try {
    const [program, ...args] = splitShellWords(commandString);
    const normalizedArgs = [];
    for (const arg of args) {
      if (program === 'node' && args.includes('--test')) {
        const clean = arg.replace(/[\\/]+$/, '');
        try {
          if (clean && existsSync(join(ROOT, clean)) && statSync(join(ROOT, clean)).isDirectory()) {
            const files = readdirSync(join(ROOT, clean))
              .filter(f => f.endsWith('.test.mjs') || f.endsWith('.test.js'))
              .map(f => `${clean}/${f}`.replace(/\\/g, '/'));
            normalizedArgs.push(...files);
            continue;
          }
        } catch {}
      }
      normalizedArgs.push(arg);
    }
    const windowsCommandShim = process.platform === 'win32'
      && ['echo', 'npm', 'npx', 'pnpm', 'yarn'].includes(program.toLowerCase());
    if (windowsCommandShim) {
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', program, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } else {
      execFileSync(program, normalizedArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    }
    return { command: commandString, exit_code: 0 };
  } catch (error) {
    return { command: commandString, exit_code: typeof error.status === 'number' ? error.status : 1 };
  }
}

export async function handleVerify(changeSlug, taskId, options = {}) {
  const emitter = options.emitter || createProgressEmitter({ out: options.out ?? (options.silent ? null : process.stdout) });
  if (options.check) {
    const gateResult = await verifyTask({ changeSlug, taskId, ...options, check: true, emitter });
    const result = {
      ok: gateResult.ok,
      ...(gateResult.idempotent ? { idempotent: true } : {}),
      ...(gateResult.reason ? { reason: gateResult.reason } : {}),
    };
    console.log(JSON.stringify({ change: changeSlug, task: taskId, result }, null, 2));
    return result;
  }
  const result = await verifyTask({ changeSlug, taskId, ...options, emitter });
  if (!options.silent && !options.emitter) {
    console.log(result.summary);
  }
  return result;
}
