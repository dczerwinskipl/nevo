// Command verification gate implementation.

import { execSync } from 'node:child_process';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { WorkflowError } from '../errors.mjs';

/** Built-in logical command verification aliases */
export const KNOWN_COMMAND_ACTIONS = new Set(['test', 'build']);

/**
 * Resolves the target shell command for a command gate configuration.
 * Fails closed on unknown logical command aliases.
 *
 * @param {object} config - Gate configuration
 * @param {object} [context={}] - Context containing overrides or environment facts
 * @returns {string}
 * @throws {WorkflowError} If action alias is unknown or configuration is invalid
 */
export function resolveCommandTarget(config, context = {}) {
  if (!config || typeof config !== 'object') {
    throw new WorkflowError('CommandGate requires a valid configuration object');
  }

  if (typeof config.command === 'string' && config.command.trim()) {
    return config.command.trim();
  }

  if (typeof config.action === 'string' && config.action.trim()) {
    const action = config.action.trim();

    // 1. Check explicit caller/environment verification command maps
    if (context.verificationCommands && typeof context.verificationCommands[action] === 'string' && context.verificationCommands[action].trim()) {
      return context.verificationCommands[action].trim();
    }
    if (context.actionCommands && typeof context.actionCommands[action] === 'string' && context.actionCommands[action].trim()) {
      return context.actionCommands[action].trim();
    }

    // 2. Built-in standard command aliases
    if (action === 'test') {
      return context.testCommand || 'npm test';
    }
    if (action === 'build') {
      return context.buildCommand || 'npm run build';
    }

    // 3. Fail closed on unknown logical alias (no silent fallback to action string)
    throw new WorkflowError(
      `Unknown command verification alias '${action}' — must be a known alias ('test', 'build') or configured in context.verificationCommands`,
      { code: 'UNKNOWN_COMMAND_ACTION', action }
    );
  }

  throw new WorkflowError("CommandGate configuration must declare either 'action' or 'command'");
}

/**
 * Automated test/command gate.
 * Strictly separates read-only introspection (inspect) from explicit test execution (verify).
 */
export class CommandGate extends GateContract {
  get type() {
    return 'command';
  }

  /**
   * Introspects command gate status without executing child processes or running tests.
   *
   * @param {object} config - Gate configuration (declaring action or command)
   * @param {object} [context={}] - Environmental context
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config, context = {}) {
    const targetCommand = resolveCommandTarget(config, context);
    const lastResult = context.lastVerification?.[targetCommand] || context.verificationResults?.[targetCommand];
    const isStale = context.testStale ?? (lastResult ? false : true);

    let status = 'pending';
    if (lastResult) {
      status = lastResult.passed ? 'passed' : 'failed';
    }

    return new GateInspectionResult({
      gateType: this.type,
      status,
      target: targetCommand,
      message: `Command gate targets '${targetCommand}' (run verify to execute)`,
      stale: isStale,
      details: {
        action: config.action,
        command: config.command,
        targetCommand,
        lastRun: lastResult || null,
      },
    });
  }

  /**
   * Explicitly executes the target verification command.
   *
   * @param {object} config - Gate configuration
   * @param {object} [context={}] - Environmental context (can provide context.runner for mock injection)
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context = {}) {
    const targetCommand = resolveCommandTarget(config, context);

    if (typeof context.runner === 'function') {
      try {
        const result = await context.runner(targetCommand, context);
        const passed = Boolean(result?.passed ?? (result?.exitCode === 0 || result?.success));
        return new GateVerificationResult({
          gateType: this.type,
          passed,
          status: passed ? 'passed' : 'failed',
          message: passed ? `Command '${targetCommand}' passed` : `Command '${targetCommand}' failed`,
          details: {
            targetCommand,
            exitCode: result?.exitCode ?? (passed ? 0 : 1),
            stdout: result?.stdout || '',
            stderr: result?.stderr || '',
          },
        });
      } catch (err) {
        return new GateVerificationResult({
          gateType: this.type,
          passed: false,
          status: 'failed',
          message: `Command '${targetCommand}' execution failed: ${err.message}`,
          details: {
            targetCommand,
            error: err.message,
          },
        });
      }
    }

    try {
      const cwd = context.repoRoot || process.cwd();
      const stdout = execSync(targetCommand, { cwd, encoding: 'utf8', stdio: 'pipe' });
      return new GateVerificationResult({
        gateType: this.type,
        passed: true,
        status: 'passed',
        message: `Command '${targetCommand}' passed successfully`,
        details: { targetCommand, exitCode: 0, stdout },
      });
    } catch (err) {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'failed',
        message: `Command '${targetCommand}' failed with exit code ${err.status ?? 1}`,
        details: {
          targetCommand,
          exitCode: err.status ?? 1,
          stdout: err.stdout ? String(err.stdout) : '',
          stderr: err.stderr ? String(err.stderr) : '',
          error: err.message,
        },
      });
    }
  }
}
