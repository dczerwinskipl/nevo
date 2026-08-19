// Command verification gate implementation.

import { execSync } from 'node:child_process';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { WorkflowError } from '../errors.mjs';

/** Canonical built-in logical command verification aliases */
export const DEFAULT_COMMAND_ACTIONS = new Set(['test', 'build']);

/** Alias for backward compatibility */
export const KNOWN_COMMAND_ACTIONS = DEFAULT_COMMAND_ACTIONS;

/**
 * Resolves the target shell command for a command gate configuration.
 * Fails closed on unknown logical command aliases.
 *
 * @param {object} config - Gate configuration
 * @param {object} [context={}] - Context containing overrides or environment facts
 * @param {Set<string>|Array<string>} [catalog=null] - Allowed logical command aliases
 * @returns {string}
 * @throws {WorkflowError} If action alias is unknown or configuration is invalid
 */
export function resolveCommandTarget(config, context = {}, catalog = null) {
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

    // 2. Allowed catalog check
    const allowedCatalog = catalog
      ? (catalog instanceof Set ? catalog : new Set(catalog))
      : DEFAULT_COMMAND_ACTIONS;

    if (!allowedCatalog.has(action)) {
      throw new WorkflowError(
        `Unknown command verification alias '${action}' — must be a known alias (${[...allowedCatalog].join(', ')}) or configured in context.verificationCommands`,
        { code: 'UNKNOWN_COMMAND_ACTION', action }
      );
    }

    // 3. Built-in standard command aliases
    if (action === 'test') {
      return context.testCommand || 'npm test';
    }
    if (action === 'build') {
      return context.buildCommand || 'npm run build';
    }
  }

  throw new WorkflowError("CommandGate configuration must declare either 'action' or 'command'");
}

/**
 * Evaluates runner output using a strict, non-coercive contract.
 *
 * @param {any} rawResult
 * @param {string} targetCommand
 * @returns {{ passed: boolean, exitCode: number, error?: string }}
 */
function evaluateRunnerResult(rawResult, targetCommand) {
  if (!rawResult || typeof rawResult !== 'object') {
    return {
      passed: false,
      exitCode: 1,
      error: `Runner returned invalid non-object result for '${targetCommand}'`,
    };
  }

  // Strict primitive type validation — reject string "false", "0", etc.
  if (rawResult.passed !== undefined && typeof rawResult.passed !== 'boolean') {
    return {
      passed: false,
      exitCode: 1,
      error: `Runner result.passed must be a strict boolean, got '${typeof rawResult.passed}'`,
    };
  }

  if (rawResult.success !== undefined && typeof rawResult.success !== 'boolean') {
    return {
      passed: false,
      exitCode: 1,
      error: `Runner result.success must be a strict boolean, got '${typeof rawResult.success}'`,
    };
  }

  if (rawResult.exitCode !== undefined && !Number.isInteger(rawResult.exitCode)) {
    return {
      passed: false,
      exitCode: 1,
      error: `Runner result.exitCode must be a strict integer, got '${typeof rawResult.exitCode}'`,
    };
  }

  // Contradiction checks
  if (rawResult.passed !== undefined && rawResult.success !== undefined && rawResult.passed !== rawResult.success) {
    return {
      passed: false,
      exitCode: 1,
      error: `Contradictory runner result: passed=${rawResult.passed} vs success=${rawResult.success}`,
    };
  }

  if (rawResult.passed === true && rawResult.exitCode !== undefined && rawResult.exitCode !== 0) {
    return {
      passed: false,
      exitCode: rawResult.exitCode,
      error: `Contradictory runner result: passed=true but exitCode=${rawResult.exitCode}`,
    };
  }

  if (rawResult.passed === false && rawResult.exitCode === 0) {
    return {
      passed: false,
      exitCode: 1,
      error: 'Contradictory runner result: passed=false but exitCode=0',
    };
  }

  // Authoritative pass determination
  let passed;
  if (rawResult.passed !== undefined) {
    passed = rawResult.passed;
  } else if (rawResult.success !== undefined) {
    passed = rawResult.success;
  } else if (rawResult.exitCode !== undefined) {
    passed = rawResult.exitCode === 0;
  } else {
    passed = false;
  }

  return {
    passed,
    exitCode: rawResult.exitCode !== undefined ? rawResult.exitCode : (passed ? 0 : 1),
  };
}

/**
 * Automated test/command gate.
 * Strictly separates read-only introspection (inspect) from explicit test execution (verify).
 */
export class CommandGate extends GateContract {
  /**
   * @param {object} [options={}]
   * @param {Function} [options.runner=null] - Trusted runner capability (dependency injection)
   * @param {Set<string>|Array<string>} [options.commandCatalog=null] - Allowed logical command aliases
   * @param {Record<string, string>} [options.verificationCommands={}] - Custom command mappings
   */
  constructor({ runner = null, commandCatalog = null, verificationCommands = {} } = {}) {
    super();
    this._runner = typeof runner === 'function' ? runner : null;
    this._commandCatalog = commandCatalog
      ? (commandCatalog instanceof Set ? commandCatalog : new Set(commandCatalog))
      : null;
    this._verificationCommands = verificationCommands && typeof verificationCommands === 'object'
      ? { ...verificationCommands }
      : {};
  }

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
    const effectiveContext = {
      ...context,
      verificationCommands: {
        ...this._verificationCommands,
        ...(context.verificationCommands || {}),
      },
    };
    const targetCommand = resolveCommandTarget(config, effectiveContext, this._commandCatalog);
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
      stale: typeof isStale === 'boolean' ? isStale : Boolean(isStale),
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
   * @param {object} [context={}] - Environmental context
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context = {}) {
    const effectiveContext = {
      ...context,
      verificationCommands: {
        ...this._verificationCommands,
        ...(context.verificationCommands || {}),
      },
    };
    const targetCommand = resolveCommandTarget(config, effectiveContext, this._commandCatalog);
    const runner = this._runner || context.runner;

    if (typeof runner === 'function') {
      try {
        const rawResult = await runner(targetCommand, effectiveContext);
        const evalResult = evaluateRunnerResult(rawResult, targetCommand);
        const passed = evalResult.passed;

        return new GateVerificationResult({
          gateType: this.type,
          passed,
          status: passed ? 'passed' : 'failed',
          message: evalResult.error || (passed ? `Command '${targetCommand}' passed` : `Command '${targetCommand}' failed`),
          details: {
            targetCommand,
            exitCode: evalResult.exitCode,
            stdout: rawResult?.stdout || '',
            stderr: rawResult?.stderr || '',
            ...(evalResult.error ? { error: evalResult.error } : {}),
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

    if (!context.repoRoot || typeof context.repoRoot !== 'string' || !context.repoRoot.trim()) {
      throw new WorkflowError(
        `CommandGate verification requires explicit 'context.repoRoot' for process execution`,
        { code: 'MISSING_REPO_ROOT', targetCommand }
      );
    }

    try {
      const cwd = context.repoRoot.trim();
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
