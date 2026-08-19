// Deterministic workflow subsystem public exports.

export {
  WORKFLOW_MODES,
  DEFAULT_WORKFLOW_MODE,
  DEFAULT_WORKFLOW_VERSION,
  DEFAULT_WORKFLOW_DEFINITION,
  resolveWorkflowMode,
} from './compatibility.mjs';

export {
  ALLOWED_PARAM_TYPES,
  KNOWN_CONSTRAINT_KEYS,
  validateActionParameterSchemas,
  assertActionParameterSchemas,
  validateActionInputs,
  assertActionInputs,
} from './input-schema.mjs';

export {
  ActionCheckResult,
  ActionExecuteResult,
  ActionContract,
  GateContract,
} from './contracts.mjs';

export {
  GateInspectionResult,
  GateVerificationResult,
  CommandGate,
  DEFAULT_COMMAND_ACTIONS,
  KNOWN_COMMAND_ACTIONS,
  resolveCommandTarget,
  MarkdownGate,
  analyzeMarkdownArtifact,
  HumanVerificationGate,
  HumanVerificationReader,
  MemoryHumanVerificationReader,
  resolveHumanScopeTarget,
} from './gates/index.mjs';

export {
  ActionRegistry,
  GateRegistry,
  createDefaultGateRegistry,
  defaultActionRegistry,
  defaultGateRegistry,
} from './registry.mjs';

export {
  WorkflowEngine,
  defaultWorkflowEngine,
} from './engine.mjs';

export {
  KNOWN_GATE_TYPES,
  validateGateDefinition,
  validateActionReference,
  validateTransitionDefinition,
  validateWorkflowDefinition,
  normalizeWorkflowDefinition,
} from './definitions/schema.mjs';

export {
  WORKFLOWS_REL_DIR,
  TEMPLATES_DIR,
  resolveWorkflowPath,
  parseWorkflowDefinition,
  loadWorkflowDefinition,
  listRepositoryWorkflowDefinitions,
  listBuiltInWorkflowTemplates,
} from './definitions/loader.mjs';

export {
  WorkflowError,
  PreconditionError,
  GateBlockedError,
  WorkflowDefinitionError,
} from './errors.mjs';
