// Compatibility forwarding layer for tools/specs/lifecycle.mjs
// Individual pure lifecycle capabilities live in tools/specs/lifecycle/ and tools/specs/lifecycle-primitives.mjs.

export * from './lifecycle/index.mjs';
export {
  evaluateGate, gateDefinitions, actionDefinitions, validatorRegistry, registerValidator,
} from './gates.mjs';
