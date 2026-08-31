import { resolveCanonicalSpec } from './identity.mjs';
import { requireTask } from './store.mjs';
// Dashboard-AI-owned capability (tools/dashboard/server/ai/sessions/) — this CLI command
// is the one genuine non-dashboard consumer of session binding (see tools/specs.mjs).
import { createAgentSessionBindingService } from '../dashboard/server/ai/sessions/binding-service.mjs';

export async function handleAgentSessionAttach(opts) {
  const specInfo = resolveCanonicalSpec(opts.spec);
  if (opts.task && specInfo.change) {
    requireTask(specInfo.change, opts.task);
  }
  const providerSessionId = opts.providerSessionId || opts.sessionId;
  const bindingService = createAgentSessionBindingService();
  const binding = await bindingService.bindSession({
    provider: opts.provider,
    providerSessionId,
    specId: specInfo.specId,
    taskId: opts.task || undefined,
    purpose: opts.purpose || 'attached',
  });

  console.log(`Bound session '${binding.providerSessionId}' (${binding.provider}) to spec '${binding.specId}'${binding.taskId ? ` (task: ${binding.taskId})` : ''}.`);
  return binding;
}
