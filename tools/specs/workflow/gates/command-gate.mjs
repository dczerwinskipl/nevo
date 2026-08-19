// Command verification gate implementation.

import { execSync } from 'node:child_process';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { defaultCommandCatalog, CommandCatalog } from './command-catalog.mjs';
import { WorkflowError } from '../errors.mjs';

/** Canonical built-in command actions alias for backward compatibility */
export const DEFAULT_COMMAND_ACTIONS = defaultCommandCatalog.asSet();
export const KNOWN_COMMAND_ACTIONS = DEFAULT_COMMAND_ACTIONS;

/**
 * Abstract reader interface for accessing trusted recorded command verification results.
 */
export class CommandVerificationReader {
  /**
   * Retrieves recorded verification result for a command.
   *
   * @param {object} query
   * @param {string} query.command - Concrete shell command
   * @param {string} [query.action] - Logical action alias
   * @returns {Promise<object|null>|object|null}
   */
  getCommandResult(query) {
    throw new Error('CommandVerificationReader.getCommandResult() must be implemented');
  }
}

/**
 * In-memory implementation of CommandVerificationReader for testing and composition.
 */
export class MemoryCommandVerificationReader extends CommandVerificationReader {
  /**
   * @param {Record<string, object>} [results={}]
   */
  constructor(results = {}) {
    super();
    this._results = new Map(Object.entries(results));
  }

  /**
   * Sets a verification result in memory.
   * @param {string} commandOrAction
   * @param {object} result
   */
  setResult(commandOrAction, result) {
    if (commandOrAction && typeof result === 'object' && result !== null) {
      this._results.set(commandOrAction, result);
    }
  }

  getCommandResult({ command, action }) {
    return this._results.get(command) || (action ? this._results.get(action) : null) || null;
  }
}

/**
 * Resolves the target shell command using a trusted CommandCatalog.
 * Fails closed on unknown logical command aliases.
 *
 * @param {object} config - Gate configuration
 * @param {CommandCatalog} [catalog=defaultCommandCatalog] - Trusted command catalog
 * @returns {string} Target shell command
 * @throws {WorkflowError} If action alias is unknown or configuration is invalid
 */
export function resolveCommandTarget(config, catalog = defaultCommandCatalog) {
  const cat = catalog instanceof CommandCatalog ? catalog : defaultCommandCatalog;
  return cat.resolve(config);
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
 * All trusted capabilities (runner, command catalog, verification reader) must be injected at construction.
 */
export class CommandGate extends GateContract {
  /**
   * @param {object} [options={}]
   * @param {Function} [options.runner=null] - Trusted runner capability (DI only)
   * @param {CommandCatalog} [options.commandCatalog=defaultCommandCatalog] - Trusted command catalog (DI only)
   * @param {CommandVerificationReader} [options.verificationReader=null] - Trusted verification reader (DI only)
   */
  constructor({ runner = null, commandCatalog = defaultCommandCatalog, verificationReader = null } = {}) {
    super();
    this._runner = typeof runner === 'function' ? runner : null;
    this._commandCatalog = commandCatalog instanceof CommandCatalog
      ? commandCatalog
      : (commandCatalog ? new CommandCatalog(commandCatalog) : defaultCommandCatalog);
    this._verificationReader = verificationReader;
  }

  get type() {
    return 'command';
  }

  /**
   * Introspects command gate status using trusted dependencies without executing test commands.
   * Runtime context cannot manufacture passed status or override command mappings.
   *
   * @param {object} config - Gate configuration (declaring action or command)
   * @param {object} [context={}] - Environmental context containing deterministic facts
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config, context = {}) {
    const targetCommand = this._commandCatalog.resolve(config);

    // Read previous verification result strictly from trusted verification reader (not caller JSON)
    let lastResult = null;
    if (this._verificationReader && typeof this._verificationReader.getCommandResult === 'function') {
      try {
        lastResult = await this._verificationReader.getCommandResult({
          command: targetCommand,
          action: config.action,
        });
      } catch {
        lastResult = null;
      }
    }

    let status = 'pending';
    let isStale = true;

    if (lastResult && typeof lastResult === 'object') {
      // Validate recorded result strictly
      if (lastResult.passed === true) {
        status = 'passed';
        isStale = typeof lastResult.stale === 'boolean' ? lastResult.stale : false;
      } else if (lastResult.passed === false || (Number.isInteger(lastResult.exitCode) && lastResult.exitCode !== 0)) {
        status = 'failed';
        isStale = typeof lastResult.stale === 'boolean' ? lastResult.stale : false;
      }
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
   * Explicitly executes the target verification command using injected trusted runner or process exec.
   *
   * @param {object} config - Gate configuration
   * @param {object} [context={}] - Environmental context (must supply explicit context.repoRoot for execSync)
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context = {}) {
    const targetCommand = this._commandCatalog.resolve(config);
    const runner = this._runner;

    if (typeof runner === 'function') {
      try {
        const rawResult = await runner(targetCommand, context);
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
