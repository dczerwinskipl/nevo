// Command verification gate implementation.

import { execSync } from 'node:child_process';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { defaultCommandCatalog, CommandCatalog } from './command-catalog.mjs';
import { WorkflowError } from '../errors.mjs';

/** Canonical built-in command actions alias for backward compatibility */
export const DEFAULT_COMMAND_ACTIONS = defaultCommandCatalog.asSet();
export const KNOWN_COMMAND_ACTIONS = DEFAULT_COMMAND_ACTIONS;

/**
 * Builds canonical composite storage key for command verification state.
 *
 * @param {string} command
 * @param {string} [action]
 * @returns {string}
 */
export function getCommandStoreKey(command, action) {
  const normCmd = typeof command === 'string' ? command.trim() : '';
  const normAct = typeof action === 'string' ? action.trim() : '';
  if (normAct) {
    return `action:${normAct}::cmd:${normCmd}`;
  }
  return `raw::cmd:${normCmd}`;
}

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
 * Binds recorded verification results to exact composite identity (action + concrete command).
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
    const command = typeof record.command === 'string' ? record.command.trim() : '';
    const action = typeof record.action === 'string' ? record.action.trim() : '';

    if (!command) return;

    const entry = {
      command,
      action: action || null,
      passed: record.passed === true,
      exitCode: Number.isInteger(record.exitCode) ? record.exitCode : (record.passed ? 0 : 1),
      stale: Boolean(record.stale),
      timestamp: record.timestamp || new Date().toISOString(),
      details: record.details || {},
    };

    const key = getCommandStoreKey(command, action);
    this._results.set(key, entry);
  }

  /** Backward-compatible setter */
  setResult(commandOrAction, result) {
    this.recordCommandResult({ command: commandOrAction, ...result });
  }

  getCommandResult({ command, action }) {
    const key = getCommandStoreKey(command, action);
    return this._results.get(key) || null;
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
   * Fails closed if no store is configured or if persistence fails.
   *
   * @param {object} config - Gate configuration
   * @param {object} [context={}] - Environmental context (must supply explicit context.repoRoot for execSync)
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context = {}) {
    const targetCommand = this._commandCatalog.resolve(config);
    const runner = this._runner;

    let evalResult;

    if (typeof runner === 'function') {
      try {
        const rawResult = await runner(targetCommand, context);
        evalResult = evaluateRunnerResult(rawResult, targetCommand);
      } catch (err) {
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

    // Require authoritative verification store to record state
    if (!this._verificationStore || typeof this._verificationStore.recordCommandResult !== 'function') {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Command '${targetCommand}' executed (passed: ${evalResult.passed}), but no authoritative verification store is configured to record state`,
        details: {
          targetCommand,
          action: config.action || null,
          exitCode: evalResult.exitCode,
          stdout: evalResult.stdout || '',
          stderr: evalResult.stderr || '',
          executionPassed: evalResult.passed,
          reason: 'verification-store-missing',
        },
      });
    }

    // Record the authoritative verification result into the trusted store
    try {
      await this._verificationStore.recordCommandResult({
        command: targetCommand,
        action: config.action || null,
        passed: evalResult.passed,
        exitCode: evalResult.exitCode,
        stale: false,
        timestamp: new Date().toISOString(),
        details: {
          stdout: evalResult.stdout || '',
          stderr: evalResult.stderr || '',
          ...(evalResult.error ? { error: evalResult.error } : {}),
        },
      });
    } catch (err) {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'failed',
        message: `Failed to record authoritative verification state for '${targetCommand}': ${err.message}`,
        details: {
          targetCommand,
          action: config.action || null,
          exitCode: evalResult.exitCode,
          error: err.message,
          executionPassed: evalResult.passed,
          reason: 'verification-record-failed',
        },
      });
    }

    return new GateVerificationResult({
      gateType: this.type,
      passed: evalResult.passed,
      status: evalResult.passed ? 'passed' : 'failed',
      message: evalResult.error || (evalResult.passed ? `Command '${targetCommand}' passed` : `Command '${targetCommand}' failed`),
      details: {
        targetCommand,
        action: config.action || null,
        exitCode: evalResult.exitCode,
        stdout: evalResult.stdout || '',
        stderr: evalResult.stderr || '',
        ...(evalResult.error ? { error: evalResult.error } : {}),
      },
    });
  }
}
