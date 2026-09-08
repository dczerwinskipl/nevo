// Built-in actions exporter. Importing this module registers every built-in action into
// the shared `defaultActionRegistry` (D12) — the same "import performs registration"
// convention `registry.mjs`'s `defaultGateRegistry` already establishes for gates.

import { defaultActionRegistry } from '../registry.mjs';
import { CommitAndPushAction } from './commit-and-push.mjs';

export { CommitAndPushAction };

if (!defaultActionRegistry.has('commit-and-push')) {
  defaultActionRegistry.register(new CommitAndPushAction());
}
