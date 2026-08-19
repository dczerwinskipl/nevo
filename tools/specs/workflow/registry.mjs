// Action and Gate registries for deterministic workflow subsystem.

import { WorkflowError } from './errors.mjs';
import { ActionContract, GateContract } from './contracts.mjs';
import { CommandGate, MarkdownGate, HumanVerificationGate, defaultCommandCatalog } from './gates/index.mjs';

/**
 * Registry for managing extensible workflow actions.
 */
export class ActionRegistry {
  constructor() {
    /** @type {Map<string, ActionContract>} */
    this._actions = new Map();
  }

  /**
   * Registers an ActionContract instance.
   *
   * @param {ActionContract} action - Action instance to register
   * @returns {this}
   * @throws {WorkflowError} If action is invalid or already registered
   */
  register(action) {
    if (!action || !(action instanceof ActionContract)) {
      throw new WorkflowError(
        `ActionRegistry.register() requires an ActionContract instance, got '${action?.constructor?.name || typeof action}'`
      );
    }

    const id = action.id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new WorkflowError(`Action must have a non-empty string 'id', got '${id}'`);
    }

    const normalizedId = id.trim();
    if (this._actions.has(normalizedId)) {
      throw new WorkflowError(`Action '${normalizedId}' is already registered in ActionRegistry`);
    }

    this._actions.set(normalizedId, action);
    return this;
  }

  /**
   * Unregisters an action by ID.
   *
   * @param {string} actionId - Action identifier
   * @returns {boolean} True if action was found and removed, false otherwise
   */
  unregister(actionId) {
    if (typeof actionId !== 'string') return false;
    return this._actions.delete(actionId.trim());
  }

  /**
   * Retrieves an action by ID, or undefined if not found.
   *
   * @param {string} actionId - Action identifier
   * @returns {ActionContract|undefined}
   */
  get(actionId) {
    if (typeof actionId !== 'string') return undefined;
    return this._actions.get(actionId.trim());
  }

  /**
   * Retrieves an action by ID, throwing WorkflowError if not found.
   *
   * @param {string} actionId - Action identifier
   * @returns {ActionContract}
   * @throws {WorkflowError} If action is not registered
   */
  require(actionId) {
    if (typeof actionId !== 'string' || !actionId.trim()) {
      throw new WorkflowError(`ActionRegistry.require() requires a non-empty string 'actionId', got '${actionId}'`);
    }

    const normalizedId = actionId.trim();
    const action = this._actions.get(normalizedId);
    if (!action) {
      throw new WorkflowError(`Unknown action '${normalizedId}' — not registered in ActionRegistry`);
    }
    return action;
  }

  /**
   * Checks whether an action ID is registered.
   *
   * @param {string} actionId - Action identifier
   * @returns {boolean}
   */
  has(actionId) {
    if (typeof actionId !== 'string') return false;
    return this._actions.has(actionId.trim());
  }

  /**
   * Lists all registered action identifiers.
   *
   * @returns {string[]}
   */
  list() {
    return Array.from(this._actions.keys());
  }

  /**
   * Returns all registered action instances.
   *
   * @returns {ActionContract[]}
   */
  getAll() {
    return Array.from(this._actions.values());
  }

  /**
   * Clears all registered actions.
   */
  clear() {
    this._actions.clear();
  }
}

/**
 * Registry for managing workflow gate handlers.
 */
export class GateRegistry {
  constructor() {
    /** @type {Map<string, GateContract>} */
    this._gates = new Map();
  }

  /**
   * Registers a GateContract instance.
   *
   * @param {GateContract} gate - Gate instance to register
   * @returns {this}
   * @throws {WorkflowError} If gate is invalid or already registered
   */
  register(gate) {
    if (!gate || !(gate instanceof GateContract)) {
      throw new WorkflowError(
        `GateRegistry.register() requires a GateContract instance, got '${gate?.constructor?.name || typeof gate}'`
      );
    }

    const type = gate.type;
    if (typeof type !== 'string' || !type.trim()) {
      throw new WorkflowError(`Gate must have a non-empty string 'type', got '${type}'`);
    }

    const normalizedType = type.trim();
    if (this._gates.has(normalizedType)) {
      throw new WorkflowError(`Gate type '${normalizedType}' is already registered in GateRegistry`);
    }

    this._gates.set(normalizedType, gate);
    return this;
  }

  /**
   * Unregisters a gate handler by type.
   *
   * @param {string} type - Gate type identifier
   * @returns {boolean}
   */
  unregister(type) {
    if (typeof type !== 'string') return false;
    return this._gates.delete(type.trim());
  }

  /**
   * Retrieves a gate handler by type.
   *
   * @param {string} type - Gate type identifier
   * @returns {GateContract|undefined}
   */
  get(type) {
    if (typeof type !== 'string') return undefined;
    return this._gates.get(type.trim());
  }

  /**
   * Retrieves a gate handler by type, throwing WorkflowError if not found.
   *
   * @param {string} type - Gate type identifier
   * @returns {GateContract}
   * @throws {WorkflowError} If gate type is not registered
   */
  require(type) {
    if (typeof type !== 'string' || !type.trim()) {
      throw new WorkflowError(`GateRegistry.require() requires a non-empty string 'type', got '${type}'`);
    }

    const normalizedType = type.trim();
    const gate = this._gates.get(normalizedType);
    if (!gate) {
      throw new WorkflowError(`Unknown gate type '${normalizedType}' — not registered in GateRegistry`);
    }
    return gate;
  }

  /**
   * Checks whether a gate type is registered.
   *
   * @param {string} type - Gate type identifier
   * @returns {boolean}
   */
  has(type) {
    if (typeof type !== 'string') return false;
    return this._gates.has(type.trim());
  }

  /**
   * Lists all registered gate type identifiers.
   *
   * @returns {string[]}
   */
  list() {
    return Array.from(this._gates.keys());
  }

  /**
   * Clears all registered gates.
   */
  clear() {
    this._gates.clear();
  }
}

/** Global default action registry instance */
export const defaultActionRegistry = new ActionRegistry();

/**
 * Creates a new GateRegistry populated with built-in gates injected with explicit trusted capabilities.
 *
 * @param {object} [options={}]
 * @param {Function} [options.commandRunner=null] - Trusted runner capability (DI)
 * @param {import('./gates/index.mjs').CommandCatalog} [options.commandCatalog=defaultCommandCatalog] - Trusted command catalog
 * @param {import('./gates/index.mjs').CommandVerificationStore} [options.commandVerificationStore=null] - Trusted command verification store
 * @param {import('./gates/index.mjs').CommandVerificationReader} [options.commandVerificationReader=null] - Alias for commandVerificationStore
 * @param {import('./gates/index.mjs').HumanVerificationReader} [options.humanVerificationReader=null] - Trusted human signoff reader
 * @param {import('./gates/index.mjs').MarkdownEvidenceReader} [options.markdownEvidenceReader=null] - Trusted markdown evidence reader
 * @param {object} [options.fs] - Optional trusted filesystem interface for MarkdownGate
 * @returns {GateRegistry}
 */
export function createDefaultGateRegistry({
  commandRunner = null,
  commandCatalog = defaultCommandCatalog,
  commandVerificationStore = null,
  commandVerificationReader = null,
  humanVerificationReader = null,
  markdownEvidenceReader = null,
  fs = undefined,
} = {}) {
  const registry = new GateRegistry();
  registry.register(
    new CommandGate({
      runner: commandRunner,
      commandCatalog,
      verificationStore: commandVerificationStore || commandVerificationReader,
    })
  );
  registry.register(
    new MarkdownGate({
      evidenceReader: markdownEvidenceReader,
      ...(fs ? { fs } : {}),
    })
  );
  registry.register(
    new HumanVerificationGate({
      verificationReader: humanVerificationReader,
    })
  );
  return registry;
}

/** Global default gate registry instance */
export const defaultGateRegistry = createDefaultGateRegistry();
