// Declarative workflow definition schema and validation.

export const KNOWN_GATE_TYPES = new Set(['command', 'markdown', 'human']);
export const KNOWN_COMMAND_ACTIONS = new Set(['test', 'build']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a workflow gate configuration.
 *
 * @param {object} gate - Gate definition object
 * @param {string} label - Context label for error messages
 * @param {string[]} errors - Output error collector
 * @param {object} [options]
 * @param {Set<string>|Array<string>} [options.knownGates] - Optional set of allowed gate types
 * @param {Set<string>|Array<string>} [options.knownCommandActions] - Optional set of allowed command aliases (e.g. 'test', 'build')
 */
export function validateGateDefinition(gate, label, errors, { knownGates, knownCommandActions } = {}) {
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
      } else if (knownCommandActions) {
        const allowed = knownCommandActions instanceof Set ? knownCommandActions : new Set(knownCommandActions);
        if (!allowed.has(gate.action.trim())) {
          errors.push(
            `${label}: unknown command gate action alias '${gate.action}' (expected one of: ${[...allowed].join(', ')})`
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
 * Validates a workflow transition definition.
 *
 * @param {string|object} transition - Transition target or object
 * @param {string} label - Context label for error messages
 * @param {string[]} errors - Output error collector
 */
export function validateTransitionDefinition(transition, label, errors) {
  const target = typeof transition === 'string' ? transition : transition?.to;
  if (typeof target !== 'string' || !target.trim()) {
    errors.push(`${label}: transition must specify a non-empty target 'to'`);
  }
}

/**
 * Validates an entire workflow definition object.
 *
 * @param {object} definition - Parsed workflow definition object
 * @param {object} [options]
 * @param {Set<string>|Array<string>} [options.knownActions] - Allowed action IDs for step actions / finalize
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

  if (!isPlainObject(definition.steps) || Object.keys(definition.steps).length === 0) {
    errors.push(`${label}: 'steps' must be an object with at least one step`);
    return { valid: false, errors };
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
        stepConfig.actions.forEach((act, idx) => {
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
        stepConfig.finalize.forEach((act, idx) => {
          validateActionReference(act, `${stepLabel}.finalize[${idx}]`, errors, options);
        });
      }
    }

    if (stepConfig.transitions !== undefined) {
      if (!Array.isArray(stepConfig.transitions)) {
        errors.push(`${stepLabel}.transitions: must be an array`);
      } else {
        stepConfig.transitions.forEach((t, idx) => {
          validateTransitionDefinition(t, `${stepLabel}.transitions[${idx}]`, errors);
        });
      }
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

  for (const [stepName, stepConfig] of Object.entries(definition.steps || {})) {
    normalizedSteps[stepName] = {
      entryGates: (stepConfig.entryGates || []).map(g => (typeof g === 'string' ? { type: g } : { ...g })),
      actions: (stepConfig.actions || []).map(a => (typeof a === 'string' ? { id: a } : { ...a })),
      exitGates: (stepConfig.exitGates || []).map(g => (typeof g === 'string' ? { type: g } : { ...g })),
      finalize: (stepConfig.finalize || []).map(a => (typeof a === 'string' ? { id: a } : { ...a })),
      transitions: (stepConfig.transitions || []).map(t => (typeof t === 'string' ? { to: t } : { ...t })),
    };
  }

  return {
    id: definition.id,
    title: definition.title || definition.id,
    type: definition.type || 'standard',
    version: definition.version || 1,
    steps: normalizedSteps,
  };
}
