// Command verification gate implementation.

import { execSync } from 'node:child_process';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { defaultCommandCatalog, CommandCatalog } from './command-catalog.mjs';
import { WorkflowError } from '../errors.mjs';

/** Canonical built-in command actions alias for backward compatibility */
export const DEFAULT_COMMAND_ACTIONS = defaultCommandCatalog.asSet();
export const KNOWN_COMMAND_ACTIONS = DEFAULT_COMMAND_ACTIONS;

/**
 * Abstract interface for accessing trusted recorded command verification state.
 */
export class CommandVerificationStore {
  /**
   * Retrieves recorded verification result for a command.
   *
   * @param {object} query
   * @param {string} query.command - Concrete shell command
   * @param {string} [query.action] - Logical action alias
   * @returns {Promise<object|null>|object|null}
   */
  getCommandResult(query) {
    throw new Error('CommandVerificationStore.getCommandResult() must be implemented');
  }

  /**
   * Records verification result for a command.
   *
   * @param {object} record
   * @param {string} record.command
   * @param {string} [record.action]
   * @param {boolean} record.passed
   * @param {number} [record.exitCode]
   * @param {boolean} [record.stale=false]
   * @param {string} [record.timestamp]
   * @param {Record<string, any>} [record.details]
   * @returns {Promise<void>|void}
   */
  recordCommandResult(record) {
    throw new Error('CommandVerificationStore.recordCommandResult() must be implemented');
  }
}

/** Backward-compatible alias for reader */
export const CommandVerificationReader = CommandVerificationStore;

/**
 * In-memory implementation of CommandVerificationStore for testing and composition.
 */
export class MemoryCommandVerificationStore extends CommandVerificationStore {
  /**
   * @param {Record<string, object>} [initialResults={}]
   */
  constructor(initialResults = {}) {
    super();
    this._results = new Map();
    for (const [key, value] of Object.entries(initialResults)) {
      this.recordCommandResult({ command: key, ...value });
    }
  }

  /**
   * Records a command verification result in memory.
   * @param {object} record
   */
  recordCommandResult(record) {
    if (!record || typeof record !== 'object') return;
    const commandKey = typeof record.command === 'string' ? record.command.trim() : '';
    const actionKey = typeof record.action === 'string' ? record.action.trim() : '';

    const entry = {
      command: commandKey,
      action: actionKey || null,
      passed: record.passed === true,
      exitCode: Number.isInteger(record.exitCode) ? record.exitCode : (record.passed ? 0 : 1),
      stale: Boolean(record.stale),
      timestamp: record.timestamp || new Date().toISOString(),
      details: record.details || {},
    };

    if (commandKey) {
      this._results.set(commandKey, entry);
    }
    if (actionKey) {
      this._results.set(actionKey, entry);
    }
  }

  /** Backward-compatible setter */
  setResult(commandOrAction, result) {
    this.recordCommandResult({ command: commandOrAction, ...result });
  }

  getCommandResult({ command, action }) {
    if (command && this._results.has(command.trim())) {
      return this._results.get(command.trim());
    }
    if (action && this._results.has(action.trim())) {
      return this._results.get(action.trim());
    }
    return null;
  }
}

/** Backward-compatible alias */
export const MemoryCommandVerificationReader = MemoryCommandVerificationStore;

/**
 * Resolves the target shell command using a trusted CommandCatalog.
 * Fails closed on unknown logical command aliases or ambiguous configs.
 *
 * @param {object} config - Gate configuration
 * @param {CommandCatalog} [catalog=defaultCommandCatalog] - Trusted command catalog
 * @returns {string} Target shell command
 * @throws {WorkflowError} If configuration is invalid
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
 * @returns {{ passed: boolean, exitCode: number, error?: string, stdout?: string, stderr?: string }}
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
    stdout: typeof rawResult.stdout === 'string' ? rawResult.stdout : '',
    stderr: typeof rawResult.stderr === 'string' ? rawResult.stderr : '',
  };
}

/**
 * Automated test/command gate.
 * Strictly separates read-only introspection (inspect) from explicit test execution (verify).
 * All trusted capabilities (runner, command catalog, verification store) must be injected at construction.
 */
export class CommandGate extends GateContract {
  /**
   * @param {object} [options={}]
   * @param {Function} [options.runner=null] - Trusted runner capability (DI only)
   * @param {CommandCatalog} [options.commandCatalog=defaultCommandCatalog] - Trusted command catalog (DI only)
   * @param {CommandVerificationStore} [options.verificationStore=null] - Trusted verification state store (DI only)
   * @param {CommandVerificationStore} [options.verificationReader=null] - Alias for verificationStore
   */
  constructor({
    runner = null,
    commandCatalog = defaultCommandCatalog,
    verificationStore = null,
    verificationReader = null,
  } = {}) {
    super();
    this._runner = typeof runner === 'function' ? runner : null;
    this._commandCatalog = commandCatalog instanceof CommandCatalog
      ? commandCatalog
      : (commandCatalog ? new CommandCatalog(commandCatalog) : defaultCommandCatalog);
    this._verificationStore = verificationStore || verificationReader || null;
  }

  get type() {
    return 'command';
  }

  /**
   * Introspects command gate status using trusted store without executing test commands.
   * Runtime context cannot manufacture passed status or override command mappings.
   *
   * @param {object} config - Gate configuration (declaring action or command)
   * @param {object} [context={}] - Environmental context containing deterministic facts
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config, context = {}) {
    const targetCommand = this._commandCatalog.resolve(config);

    // Read previous verification result strictly from trusted verification store (not caller JSON)
    let lastResult = null;
    if (this._verificationStore && typeof this._verificationStore.getCommandResult === 'function') {
      try {
        lastResult = await this._verificationStore.getCommandResult({
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
   * Explicitly executes the target verification command and records the authoritative result to the store.
   *
   * @param {object} config - Gate configuration
   * @param {object} [context={}] - Environmental context (must supply explicit context.repoRoot for execSync)
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context = {}) {
    const targetCommand = this._commandCatalog.resolve(config);
    const runner = this._runner;

    let evalResult;
    let rawError = null;

    if (typeof runner === 'function') {
      try {
        const rawResult = await runner(targetCommand, context);
        evalResult = evaluateRunnerResult(rawResult, targetCommand);
      } catch (err) {
        rawError = err.message;
        evalResult = {
          passed: false,
          exitCode: 1,
          error: `Command '${targetCommand}' execution failed: ${err.message}`,
        };
      }
    } else {
      if (!context.repoRoot || typeof context.repoRoot !== 'string' || !context.repoRoot.trim()) {
        throw new WorkflowError(
          `CommandGate verification requires explicit 'context.repoRoot' for process execution`,
          { code: 'MISSING_REPO_ROOT', targetCommand }
        );
      }

      try {
        const cwd = context.repoRoot.trim();
        const stdout = execSync(targetCommand, { cwd, encoding: 'utf8', stdio: 'pipe' });
        evalResult = {
          passed: true,
          exitCode: 0,
          stdout,
          stderr: '',
        };
      } catch (err) {
        evalResult = {
          passed: false,
          exitCode: err.status ?? 1,
          stdout: err.stdout ? String(err.stdout) : '',
          stderr: err.stderr ? String(err.stderr) : '',
          error: `Command '${targetCommand}' failed with exit code ${err.status ?? 1}`,
        };
      }
    }

    const passed = evalResult.passed;

    // Record the authoritative verification result into the trusted store
    if (this._verificationStore && typeof this._verificationStore.recordCommandResult === 'function') {
      try {
        await this._verificationStore.recordCommandResult({
          command: targetCommand,
          action: config.action || null,
          passed,
          exitCode: evalResult.exitCode,
          stale: false,
          timestamp: new Date().toISOString(),
          details: {
            stdout: evalResult.stdout || '',
            stderr: evalResult.stderr || '',
            ...(evalResult.error ? { error: evalResult.error } : {}),
          },
        });
      } catch {
        // Store failure is non-fatal to verification result evaluation
      }
    }

    return new GateVerificationResult({
      gateType: this.type,
      passed,
      status: passed ? 'passed' : 'failed',
      message: evalResult.error || (passed ? `Command '${targetCommand}' passed` : `Command '${targetCommand}' failed`),
      details: {
        targetCommand,
        exitCode: evalResult.exitCode,
        stdout: evalResult.stdout || '',
        stderr: evalResult.stderr || '',
        ...(evalResult.error ? { error: evalResult.error } : {}),
      },
    });
  }
}
