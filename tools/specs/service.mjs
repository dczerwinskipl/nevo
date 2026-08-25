// Compatibility forwarding layer for tools/specs/service.mjs
// Individual domain capabilities live in:
// - tools/specs/store.mjs (change and task persistence)
// - tools/specs/identity.mjs (stable identity, spec ID validation and creation)
// - tools/specs/fingerprint.mjs (deterministic fingerprint calculations)
// - tools/specs/context.mjs (context packet construction and routing)
// - tools/specs/indexes.mjs (index generation and validation)
// - tools/specs/follow-ups.mjs (follow-up ledger persistence)

export * from './store.mjs';
export * from './identity.mjs';
export * from './fingerprint.mjs';
export * from './context.mjs';
export * from './indexes.mjs';
export * from './follow-ups.mjs';
