// Declarative workflow definition schema and validation.

import { defaultCommandCatalog, CommandCatalog } from '../gates/command-catalog.mjs';
import { TERMINAL_STATUSES } from '../../lifecycle-primitives.mjs';

export const KNOWN_GATE_TYPES = new Set(['command', 'markdown', 'human']);
export const KNOWN_COMMAND_ACTIONS = defaultCommandCatalog.asSet();

// D30: safe identifier contract for every workflow-definition-declared logical
// id — step keys, `entryStep`, a step-name-shaped transition target, and any
// gate's explicit `id`. No slashes/backslashes (these ids are embedded directly
// into filesystem paths for the durable finish-operation record, D23, and the
// human-verification signoff store, D24), no empty strings.
export const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

// D25: structured, declarative per-step behavior contract — never engine-generated prose.
const HINT_TYPES = new Set(['doc', 'skill', 'file']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** D30: shared safe-identifier check — fails closed on anything but a non-empty
 * `^[a-zA-Z0-9_-]+$` string. */
export function validateSafeIdentifier(value, label, errors) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(value)) {
    errors.push(`${label}: must be a non-empty identifier matching ${SAFE_IDENTIFIER_PATTERN} (no slashes, dots, or empty), got '${JSON.stringify(value)}'`);
    return false;
  }
  return true;
}

/**
 * Validates a workflow gate configuration.
 *
 * @param {object} gate - Gate definition object
 * @param {string} label - Context label for error messages
 * @param {string[]} errors - Output error collector
 * @param {object} [options]
 * @param {Set<string>|Array<string>} [options.knownGates] - Optional set of allowed gate types
 * @param {CommandCatalog|Set<string>|Array<string>} [options.commandCatalog] - Optional command catalog for alias validation
 * @param {Set<string>|Array<string>} [options.knownCommandActions] - Optional set of allowed command aliases
 */
export function validateGateDefinition(gate, label, errors, { knownGates, commandCatalog, knownCommandActions } = {}) {
  if (!isPlainObject(gate)) {
    errors.push(`${label}: gate must be an object`);
    return;
  }

  if (typeof gate.type !== 'string' || !gate.type.trim()) {
    errors.push(`${label}: gate missing 'type'`);
    return;
  }

  const allowedGateTypes = knownGates ? new Set(knownGates) : KNOWN_GATE_TYPES;
  if (!allowedGateTypes.has(gate.type)) {
    errors.push(`${label}: unknown gate type '${gate.type}' (expected one of: ${[...allowedGateTypes].join(', ')})`);
    return;
  }

  // D30: a gate's explicit `id` (any type) must itself be a safe identifier — it may be
  // embedded into the human-verification signoff path (D24) regardless of gate type
  // consistency, and a malformed id is a configuration error at the same boundary as an
  // unsafe step name.
  if (gate.id !== undefined) {
    validateSafeIdentifier(gate.id, `${label}.id`, errors);
  }

  if (gate.type === 'command') {
    const hasAction = gate.action !== undefined;
    const hasCommand = gate.command !== undefined;

    if (!hasAction && !hasCommand) {
      errors.push(`${label}: command gate must declare either 'action' or 'command'`);
    } else if (hasAction && hasCommand) {
      errors.push(`${label}: command gate cannot declare both 'action' and 'command' — specify exactly one execution target`);
    }

    if (hasAction) {
      if (typeof gate.action !== 'string' || !gate.action.trim()) {
        errors.push(`${label}: command gate 'action' must be a non-empty string`);
      } else {
        const actionAlias = gate.action.trim();
        const catalog = commandCatalog || knownCommandActions || defaultCommandCatalog;

        let isAllowed = false;
        let allowedList = [];

        if (catalog instanceof CommandCatalog) {
          isAllowed = catalog.has(actionAlias);
          allowedList = catalog.listAliases();
        } else if (catalog instanceof Set) {
          isAllowed = catalog.has(actionAlias);
          allowedList = Array.from(catalog);
        } else if (Array.isArray(catalog)) {
          isAllowed = catalog.includes(actionAlias);
          allowedList = catalog;
        }

        if (!isAllowed) {
          errors.push(
            `${label}: unknown command gate action alias '${gate.action}' (expected one of: ${allowedList.join(', ')})`
          );
        }
      }
    }

    if (hasCommand) {
      if (typeof gate.command !== 'string' || !gate.command.trim()) {
        errors.push(`${label}: command gate 'command' must be a non-empty string`);
      }
    }
  } else if (gate.type === 'markdown') {
    if (gate.file !== undefined && (typeof gate.file !== 'string' || !gate.file.trim())) {
      errors.push(`${label}: markdown gate 'file' must be a non-empty string`);
    }
  } else if (gate.type === 'human') {
    if (gate.required !== undefined && typeof gate.required !== 'boolean') {
      errors.push(`${label}: human gate 'required' must be a boolean`);
    }
  }
}

/**
 * Validates a workflow action reference.
 *
 * @param {string|object} action - Action identifier string or action descriptor object
 * @param {string} label - Context label for error messages
 * @param {string[]} errors - Output error collector
 * @param {object} [options]
 * @param {Set<string>|Array<string>} [options.knownActions] - Optional set of registered action IDs
 */
export function validateActionReference(action, label, errors, { knownActions } = {}) {
  const actionId = typeof action === 'string' ? action : action?.id;

  if (typeof actionId !== 'string' || !actionId.trim()) {
    errors.push(`${label}: action must have a non-empty string 'id'`);
    return;
  }

  if (knownActions) {
    const allowed = knownActions instanceof Set ? knownActions : new Set(knownActions);
    if (!allowed.has(actionId)) {
      errors.push(`${label}: unknown action '${actionId}' (expected one of: ${[...allowed].join(', ')})`);
    }
  }
}

/**
 * Validates a workflow transition definition (D19, refined; D30).
 *
 * A transition's `to` must be exactly one of: another declared step name in the same
 * definition, or a member of the repository's canonical *terminal* status vocabulary
 * (`TERMINAL_STATUSES` — `implemented`/`verified`/`archived`/`abandoned`), never the
 * broader `TASK_STATUSES` (which also contains non-terminal states like `draft`/
 * `approved`/`in-implementation` that a finalize transition can never legitimately
 * target). Anything else — a typo, or a real-but-non-terminal status — fails validation
 * here, at load time, so it can never reach `setTaskWorkflowState`/`change.yaml`.
 *
 * @param {string|object} transition - Transition target or object
 * @param {string} label - Context label for error messages
 * @param {string[]} errors - Output error collector
 * @param {object} [options]
 * @param {Set<string>} [options.stepNames] - Every step name declared in this definition
 */
export function validateTransitionDefinition(transition, label, errors, { stepNames } = {}) {
  const target = typeof transition === 'string' ? transition : transition?.to;
  if (typeof target !== 'string' || !target.trim()) {
    errors.push(`${label}: transition must specify a non-empty target 'to'`);
    return;
  }
  if (!validateSafeIdentifier(target, `${label}.to`, errors)) return;
  if (stepNames && !stepNames.has(target) && !TERMINAL_STATUSES.has(target)) {
    errors.push(
      `${label}: transition target '${target}' is neither a declared step nor a member of ` +
      `TERMINAL_STATUSES (${[...TERMINAL_STATUSES].join(', ')})`
    );
  }
}

/**
 * Validates a step's optional declarative behavior contract (D25) — `purpose` (string),
 * `expectedWork` (object, at minimum a `summary` string), `hints` (array of
 * `{ type: 'doc'|'skill'|'file', ref: string }`). All three are author-provided,
 * structured data — this validates shape only; consuming/surfacing them is a later
 * task's scope.
 *
 * @param {object} stepConfig
 * @param {string} stepLabel
 * @param {string[]} errors
 */
export function validateStepBehaviorContract(stepConfig, stepLabel, errors) {
  if (stepConfig.purpose !== undefined && (typeof stepConfig.purpose !== 'string' || !stepConfig.purpose.trim())) {
    errors.push(`${stepLabel}.purpose: must be a non-empty string`);
  }

  if (stepConfig.expectedWork !== undefined) {
    if (!isPlainObject(stepConfig.expectedWork)) {
      errors.push(`${stepLabel}.expectedWork: must be an object`);
    } else if (typeof stepConfig.expectedWork.summary !== 'string' || !stepConfig.expectedWork.summary.trim()) {
      // D25: expectedWork is "at minimum a summary string" — summary is required whenever
      // expectedWork is declared at all, not merely validated-if-present. `expectedWork: {}`
      // must fail, not silently pass as an empty-but-valid contract.
      errors.push(`${stepLabel}.expectedWork.summary: must be a non-empty string`);
    }
  }

  if (stepConfig.hints !== undefined) {
    if (!Array.isArray(stepConfig.hints)) {
      errors.push(`${stepLabel}.hints: must be an array`);
    } else {
      stepConfig.hints.forEach((hint, idx) => {
        if (!isPlainObject(hint)) {
          errors.push(`${stepLabel}.hints[${idx}]: must be an object`);
          return;
        }
        if (!HINT_TYPES.has(hint.type)) {
          errors.push(`${stepLabel}.hints[${idx}].type: must be one of ${[...HINT_TYPES].join(', ')}, got '${hint.type}'`);
        }
        if (typeof hint.ref !== 'string' || !hint.ref.trim()) {
          errors.push(`${stepLabel}.hints[${idx}].ref: must be a non-empty string`);
        }
      });
    }
  }
}

/**
 * D37: every step declares a *required* `status: { active, completed }` pair — the
 * semantic-status identifiers `workflow step start`/`step finish` resolve to for that
 * step's runtime `active`/`completed` state. Unlike the optional D25 behavior contract
 * (`purpose`/`expectedWork`/`hints`), this is required: a step with no declared status
 * has no way to report a meaningful semantic status at all, and no code path
 * synthesizes a placeholder for one that omits it (fail-closed, no silent default).
 * Both identifiers are validated against the same `SAFE_IDENTIFIER_PATTERN` (D30) as
 * every other workflow-definition-declared logical id.
 */
export function validateStepStatusContract(stepConfig, stepLabel, errors) {
  if (!isPlainObject(stepConfig.status)) {
    errors.push(`${stepLabel}.status: must be an object with 'active' and 'completed' identifiers`);
    return;
  }
  const activeValid = validateSafeIdentifier(stepConfig.status.active, `${stepLabel}.status.active`, errors);
  const completedValid = validateSafeIdentifier(stepConfig.status.completed, `${stepLabel}.status.completed`, errors);
  // D37 correction (AC10): the two semantic-status identifiers must be distinct — a step
  // declaring the same value for both leaves `semanticStatus` unable to tell "in
  // progress" apart from "done," defeating the whole point of the pair.
  if (activeValid && completedValid && stepConfig.status.active === stepConfig.status.completed) {
    errors.push(`${stepLabel}.status: 'active' and 'completed' must be distinct, both are '${stepConfig.status.active}'`);
  }
}

const KNOWN_REMOTE_PROVIDERS = new Set(['github']);

/**
 * Validates an optional `sourceControl` workflow-definition block (D12/C13). Hierarchical,
 * not three independent flags: `enabled` gates everything, `push` is only meaningful when
 * `enabled: true`, `remote.enabled`/`remote.provider` are only meaningful when
 * `push: true`. `remote.enabled: true` with `push: false` is a fail-closed validation
 * error (D12 refinement) — never silently normalized to a different configuration.
 *
 * @param {object} sourceControl - `sourceControl` definition object (validation is a
 *   no-op when this is `undefined` — omitting it entirely means "no automation")
 * @param {string} label - Context label for error messages
 * @param {string[]} errors - Output error collector
 */
export function validateSourceControlConfig(sourceControl, label, errors) {
  if (sourceControl === undefined) return;

  if (!isPlainObject(sourceControl)) {
    errors.push(`${label}.sourceControl: must be an object`);
    return;
  }

  if (sourceControl.enabled !== undefined && typeof sourceControl.enabled !== 'boolean') {
    errors.push(`${label}.sourceControl.enabled: must be a boolean`);
  }

  if (sourceControl.push !== undefined && typeof sourceControl.push !== 'boolean') {
    errors.push(`${label}.sourceControl.push: must be a boolean`);
  }

  if (sourceControl.remote === undefined) return;

  if (!isPlainObject(sourceControl.remote)) {
    errors.push(`${label}.sourceControl.remote: must be an object`);
    return;
  }

  const remote = sourceControl.remote;

  if (remote.enabled !== undefined && typeof remote.enabled !== 'boolean') {
    errors.push(`${label}.sourceControl.remote.enabled: must be a boolean`);
  }

  if (remote.provider !== undefined && (typeof remote.provider !== 'string' || !remote.provider.trim())) {
    errors.push(`${label}.sourceControl.remote.provider: must be a non-empty string`);
  }

  if (remote.enabled === true) {
    if (typeof remote.provider !== 'string' || !KNOWN_REMOTE_PROVIDERS.has(remote.provider)) {
      errors.push(
        `${label}.sourceControl.remote.provider: must be one of: ${[...KNOWN_REMOTE_PROVIDERS].join(', ')} when remote.enabled is true (got '${remote.provider}')`
      );
    }

    // D12 refinement: fail closed, never silently normalized to remote.enabled: false.
    if (sourceControl.push === false) {
      errors.push(
        `${label}.sourceControl: remote.enabled: true is invalid when push: false — a remote provider cannot confirm a push that never happens`
      );
    }
  }
}

/**
 * Normalizes a validated `sourceControl` block into its full, explicit hierarchical shape.
 * Never called on an invalid config (the `remote.enabled: true` + `push: false`
 * contradiction is rejected by `validateSourceControlConfig` before normalization ever
 * runs) — so this only ever *collapses* an inapplicable value down to its inert default
 * (e.g. `push` specified under a disabled `sourceControl`), it never resolves a conflict.
 *
 * @param {object} [sourceControl] - Raw `sourceControl` definition object
 * @returns {{ enabled: boolean, push: boolean, remote: { enabled: boolean, provider: string|null } }}
 */
export function normalizeSourceControlConfig(sourceControl) {
  const enabled = isPlainObject(sourceControl) && sourceControl.enabled === true;
  const push = enabled && sourceControl.push === true;
  const remoteEnabled = push && isPlainObject(sourceControl?.remote) && sourceControl.remote.enabled === true;
  return {
    enabled,
    push,
    remote: {
      enabled: remoteEnabled,
      provider: remoteEnabled ? sourceControl.remote.provider : null,
    },
  };
}

/**
 * Validates an entire workflow definition object.
 * Enforces action ID uniqueness within individual step action lists.
 *
 * @param {object} definition - Parsed workflow definition object
 * @param {object} [options]
 * @param {Set<string>|Array<string>} [options.knownActions] - Allowed action IDs for step actions / finalize
 * @param {CommandCatalog|Set<string>|Array<string>} [options.commandCatalog] - Allowed command catalog for command gates
 * @param {Set<string>|Array<string>} [options.knownCommandActions] - Allowed command alias actions for command gates
 * @param {Set<string>|Array<string>} [options.knownGates] - Allowed gate types
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateWorkflowDefinition(definition, options = {}) {
  const errors = [];

  if (!isPlainObject(definition)) {
    return { valid: false, errors: ['Workflow definition must be an object'] };
  }

  const label = definition.id ? `workflow '${definition.id}'` : 'workflow';

  if (typeof definition.id !== 'string' || !definition.id.trim()) {
    errors.push(`${label}: missing or invalid 'id'`);
  }

  validateSourceControlConfig(definition.sourceControl, label, errors);

  if (!isPlainObject(definition.steps) || Object.keys(definition.steps).length === 0) {
    errors.push(`${label}: 'steps' must be an object with at least one step`);
    return { valid: false, errors };
  }

  const stepNames = new Set(Object.keys(definition.steps));

  // D30: every step key must be a safe identifier. D19 refined: a step name must never
  // collide with a terminal status — that step's own transitions could then never
  // express "finish with this terminal status" unambiguously in this definition.
  for (const stepName of stepNames) {
    validateSafeIdentifier(stepName, `${label}.steps['${stepName}']`, errors);
    if (TERMINAL_STATUSES.has(stepName)) {
      errors.push(
        `${label}.steps['${stepName}']: step name collides with a terminal lifecycle status ` +
        `(${[...TERMINAL_STATUSES].join(', ')}) — no transition in this definition could ever target ` +
        `that terminal status unambiguously`
      );
    }
  }

  // D27: explicit, optional entry step — when present, must name a real declared step.
  if (definition.entryStep !== undefined) {
    if (validateSafeIdentifier(definition.entryStep, `${label}.entryStep`, errors) && !stepNames.has(definition.entryStep)) {
      errors.push(`${label}.entryStep: '${definition.entryStep}' does not name a declared step`);
    }
  }

  for (const [stepName, stepConfig] of Object.entries(definition.steps)) {
    const stepLabel = `${label}.steps.${stepName}`;

    if (!isPlainObject(stepConfig)) {
      errors.push(`${stepLabel}: step configuration must be an object`);
      continue;
    }

    if (stepConfig.entryGates !== undefined) {
      if (!Array.isArray(stepConfig.entryGates)) {
        errors.push(`${stepLabel}.entryGates: must be an array`);
      } else {
        stepConfig.entryGates.forEach((gate, idx) => {
          validateGateDefinition(gate, `${stepLabel}.entryGates[${idx}]`, errors, options);
        });
      }
    }

    if (stepConfig.actions !== undefined) {
      if (!Array.isArray(stepConfig.actions)) {
        errors.push(`${stepLabel}.actions: must be an array`);
      } else {
        const seenActions = new Set();
        stepConfig.actions.forEach((act, idx) => {
          const actionId = typeof act === 'string' ? act.trim() : act?.id?.trim();
          if (actionId) {
            if (seenActions.has(actionId)) {
              errors.push(`${stepLabel}.actions: duplicate action reference '${actionId}' at index ${idx}`);
            } else {
              seenActions.add(actionId);
            }
          }
          validateActionReference(act, `${stepLabel}.actions[${idx}]`, errors, options);
        });
      }
    }

    if (stepConfig.exitGates !== undefined) {
      if (!Array.isArray(stepConfig.exitGates)) {
        errors.push(`${stepLabel}.exitGates: must be an array`);
      } else {
        stepConfig.exitGates.forEach((gate, idx) => {
          validateGateDefinition(gate, `${stepLabel}.exitGates[${idx}]`, errors, options);
        });
      }
    }

    if (stepConfig.finalize !== undefined) {
      if (!Array.isArray(stepConfig.finalize)) {
        errors.push(`${stepLabel}.finalize: must be an array`);
      } else {
        const seenFinalize = new Set();
        stepConfig.finalize.forEach((act, idx) => {
          const actionId = typeof act === 'string' ? act.trim() : act?.id?.trim();
          if (actionId) {
            if (seenFinalize.has(actionId)) {
              errors.push(`${stepLabel}.finalize: duplicate action reference '${actionId}' at index ${idx}`);
            } else {
              seenFinalize.add(actionId);
            }
          }
          validateActionReference(act, `${stepLabel}.finalize[${idx}]`, errors, options);
        });
      }
    }

    // D27: exactly one transition per step — every step, not a "non-terminal" subset
    // (there is no separate schema shape for terminal vs. non-terminal; "terminal" is
    // derived at resolution time from whether the one transition's `to` matches a step).
    if (!Array.isArray(stepConfig.transitions) || stepConfig.transitions.length !== 1) {
      const got = Array.isArray(stepConfig.transitions) ? stepConfig.transitions.length : 'none';
      errors.push(`${stepLabel}.transitions: must declare exactly one transition, got ${got}`);
    } else {
      validateTransitionDefinition(stepConfig.transitions[0], `${stepLabel}.transitions[0]`, errors, { stepNames });
    }

    validateStepBehaviorContract(stepConfig, stepLabel, errors);
    validateStepStatusContract(stepConfig, stepLabel, errors);

    // D30: a step with more than one human-verification gate must give each an
    // explicit, mutually-distinct `id` — never two silently sharing (or both
    // defaulting to) the same display id.
    const humanGates = [...(stepConfig.entryGates || []), ...(stepConfig.exitGates || [])]
      .filter(g => isPlainObject(g) && g.type === 'human');
    if (humanGates.length > 1) {
      const seenIds = new Set();
      humanGates.forEach((gate, idx) => {
        if (typeof gate.id !== 'string' || !gate.id.trim()) {
          errors.push(
            `${stepLabel}: step declares ${humanGates.length} human-verification gates — each must have an ` +
            `explicit, unique 'id' (missing on human gate ${idx})`
          );
          return;
        }
        if (seenIds.has(gate.id)) {
          errors.push(`${stepLabel}: duplicate human-verification gate id '${gate.id}' — ids must be mutually distinct within a step`);
        }
        seenIds.add(gate.id);
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalizes a validated workflow definition into a predictable structural shape.
 *
 * @param {object} definition
 * @returns {object} Normalized workflow definition
 */
export function normalizeWorkflowDefinition(definition) {
  const normalizedSteps = {};
  const stepNames = Object.keys(definition.steps || {});

  for (const [stepName, stepConfig] of Object.entries(definition.steps || {})) {
    normalizedSteps[stepName] = {
      entryGates: (stepConfig.entryGates || []).map(g => (typeof g === 'string' ? { type: g } : { ...g })),
      actions: (stepConfig.actions || []).map(a => (typeof a === 'string' ? { id: a } : { ...a })),
      exitGates: (stepConfig.exitGates || []).map(g => (typeof g === 'string' ? { type: g } : { ...g })),
      finalize: (stepConfig.finalize || []).map(a => (typeof a === 'string' ? { id: a } : { ...a })),
      transitions: (stepConfig.transitions || []).map(t => (typeof t === 'string' ? { to: t } : { ...t })),
      ...(stepConfig.purpose !== undefined ? { purpose: stepConfig.purpose } : {}),
      ...(stepConfig.expectedWork !== undefined ? { expectedWork: stepConfig.expectedWork } : {}),
      ...(stepConfig.hints !== undefined ? { hints: stepConfig.hints } : {}),
      // D37: required per-step semantic-status pair — always present on a validated
      // definition (`validateStepStatusContract`), unlike the optional D25 fields above.
      ...(isPlainObject(stepConfig.status) ? { status: { active: stepConfig.status.active, completed: stepConfig.status.completed } } : {}),
    };
  }

  return {
    id: definition.id,
    title: definition.title || definition.id,
    type: definition.type || 'standard',
    version: definition.version || 1,
    sourceControl: normalizeSourceControlConfig(definition.sourceControl),
    // D27: explicit entryStep when declared; otherwise the first declared step key —
    // an ordering convention already implicit in how this function itself iterates
    // `definition.steps`, made an explicit, always-present field so consumers
    // (`step-runner.mjs`) never need to know about the fallback themselves.
    entryStep: definition.entryStep || stepNames[0],
    steps: normalizedSteps,
  };
}
