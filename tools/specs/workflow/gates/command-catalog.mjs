// Neutral logical command verification catalog shared across definition validation and runtime execution.

import { WorkflowError } from '../errors.mjs';

/**
 * Built-in canonical logical command aliases mapped to standard shell commands.
 */
export const DEFAULT_COMMAND_MAPPINGS = Object.freeze({
  test: 'npm test',
  build: 'npm run build',
});

/**
 * Catalog of valid logical verification command aliases and their concrete executions.
 */
export class CommandCatalog {
  /**
   * @param {Record<string, string>} [customMappings={}] - Custom alias -> command mappings
   */
  constructor(customMappings = {}) {
    this._mappings = new Map();

    // Populate standard built-ins
    for (const [alias, cmd] of Object.entries(DEFAULT_COMMAND_MAPPINGS)) {
      this._mappings.set(alias, cmd);
    }

    // Register custom overrides or extensions
    if (customMappings && typeof customMappings === 'object') {
      for (const [alias, cmd] of Object.entries(customMappings)) {
        if (typeof alias === 'string' && alias.trim() && typeof cmd === 'string' && cmd.trim()) {
          this._mappings.set(alias.trim(), cmd.trim());
        }
      }
    }
  }

  /**
   * Checks whether a logical alias is registered in the catalog.
   *
   * @param {string} alias
   * @returns {boolean}
   */
  has(alias) {
    if (typeof alias !== 'string') return false;
    return this._mappings.has(alias.trim());
  }

  /**
   * Retrieves the target shell command for an alias.
   * Fails closed if the alias is unknown.
   *
   * @param {string} alias
   * @returns {string}
   * @throws {WorkflowError} If alias is not registered
   */
  get(alias) {
    if (typeof alias !== 'string' || !alias.trim()) {
      throw new WorkflowError('Command alias must be a non-empty string', { code: 'INVALID_COMMAND_ALIAS' });
    }
    const trimmed = alias.trim();
    if (!this._mappings.has(trimmed)) {
      throw new WorkflowError(
        `Unknown command verification alias '${trimmed}' — must be one of: [${this.listAliases().join(', ')}]`,
        { code: 'UNKNOWN_COMMAND_ACTION', action: trimmed }
      );
    }
    return this._mappings.get(trimmed);
  }

  /**
   * Lists all registered logical command alias names.
   * @returns {string[]}
   */
  listAliases() {
    return Array.from(this._mappings.keys());
  }

  /**
   * Returns registered alias names as a Set.
   * @returns {Set<string>}
   */
  asSet() {
    return new Set(this._mappings.keys());
  }

  /**
   * Resolves a gate configuration object ({ action?: string, command?: string }) to a shell command.
   * Strictly enforces XOR: requires exactly one of 'action' or 'command'.
   *
   * @param {object} config
   * @returns {string} Target shell command
   * @throws {WorkflowError} If configuration declares both, neither, or empty values
   */
  resolve(config) {
    if (!config || typeof config !== 'object') {
      throw new WorkflowError('CommandGate requires a valid configuration object', { code: 'INVALID_COMMAND_CONFIG' });
    }

    const hasAction = config.action !== undefined;
    const hasCommand = config.command !== undefined;

    if (!hasAction && !hasCommand) {
      throw new WorkflowError("CommandGate configuration must declare either 'action' or 'command'", {
        code: 'INVALID_COMMAND_CONFIG',
      });
    }

    if (hasAction && hasCommand) {
      throw new WorkflowError(
        "CommandGate configuration cannot declare both 'action' and 'command' — specify exactly one execution target",
        { code: 'AMBIGUOUS_COMMAND_CONFIG' }
      );
    }

    if (hasCommand) {
      if (typeof config.command !== 'string' || !config.command.trim()) {
        throw new WorkflowError("CommandGate 'command' must be a non-empty string", {
          code: 'INVALID_COMMAND_CONFIG',
        });
      }
      return config.command.trim();
    }

    if (hasAction) {
      if (typeof config.action !== 'string' || !config.action.trim()) {
        throw new WorkflowError("CommandGate 'action' must be a non-empty string", {
          code: 'INVALID_COMMAND_CONFIG',
        });
      }
      return this.get(config.action.trim());
    }

    throw new WorkflowError("CommandGate configuration must declare either 'action' or 'command'", {
      code: 'INVALID_COMMAND_CONFIG',
    });
  }
}

/** Global default CommandCatalog singleton with built-in 'test' and 'build' */
export const defaultCommandCatalog = new CommandCatalog();
