import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AiValidationError } from '../contracts.mjs';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export function executionPolicyFilePath(repoRoot, changeSlug) {
  if (!changeSlug || typeof changeSlug !== 'string' || !SLUG_PATTERN.test(changeSlug)) {
    throw new AiValidationError(`Invalid change slug: '${changeSlug}'`);
  }
  return join(repoRoot, '.nevo-ai-local', 'execution-policy', `${changeSlug}.json`);
}

export function validateExecutionPolicyShape(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new AiValidationError('Execution policy must be an object.');
  }
  if (typeof policy.provider !== 'string' || !policy.provider.trim()) {
    throw new AiValidationError('Execution policy provider must be a non-empty string.');
  }
  if (typeof policy.mode !== 'string' || !policy.mode.trim()) {
    throw new AiValidationError('Execution policy mode must be a non-empty string.');
  }
  if (policy.taskOverrides !== undefined) {
    if (!policy.taskOverrides || typeof policy.taskOverrides !== 'object' || Array.isArray(policy.taskOverrides)) {
      throw new AiValidationError('Execution policy taskOverrides must be an object.');
    }
    for (const [taskId, override] of Object.entries(policy.taskOverrides)) {
      if (!override || typeof override !== 'object' || Array.isArray(override)) {
        throw new AiValidationError(`taskOverrides['${taskId}'] must be an object.`);
      }
      if (override.provider !== undefined && (typeof override.provider !== 'string' || !override.provider.trim())) {
        throw new AiValidationError(`taskOverrides['${taskId}'].provider must be a non-empty string.`);
      }
      if (override.mode !== undefined && (typeof override.mode !== 'string' || !override.mode.trim())) {
        throw new AiValidationError(`taskOverrides['${taskId}'].mode must be a non-empty string.`);
      }
    }
  }
}

export class ExecutionPolicyService {
  constructor({ repoRoot = process.cwd() } = {}) {
    this.repoRoot = repoRoot;
  }

  getExecutionPolicy(changeSlug, { repoRoot = this.repoRoot } = {}) {
    const file = executionPolicyFilePath(repoRoot, changeSlug);
    if (!existsSync(file)) return null;
    try {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      validateExecutionPolicyShape(parsed);
      return parsed;
    } catch (err) {
      if (err instanceof AiValidationError) throw err;
      throw new Error(`Failed to read execution policy for '${changeSlug}': ${err.message}`);
    }
  }

  saveExecutionPolicy(changeSlug, policy, { repoRoot = this.repoRoot } = {}) {
    validateExecutionPolicyShape(policy);
    const file = executionPolicyFilePath(repoRoot, changeSlug);
    mkdirSync(dirname(file), { recursive: true });

    const normalized = {
      provider: policy.provider.trim(),
      mode: policy.mode.trim(),
      ...(policy.taskOverrides ? { taskOverrides: policy.taskOverrides } : {}),
    };

    const tempFile = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tempFile, JSON.stringify(normalized, null, 2), 'utf8');
    renameSync(tempFile, file);
    return normalized;
  }

  resolveExecutionPolicy(changeSlug, taskId = null, { repoRoot = this.repoRoot } = {}) {
    const policy = this.getExecutionPolicy(changeSlug, { repoRoot });
    if (!policy) return null;

    if (taskId && policy.taskOverrides?.[taskId]) {
      const override = policy.taskOverrides[taskId];
      return {
        provider: override.provider || policy.provider,
        mode: override.mode || policy.mode,
      };
    }

    return {
      provider: policy.provider,
      mode: policy.mode,
    };
  }
}

export const executionPolicyService = new ExecutionPolicyService();

export function computeInitialProviderAndMode(providers) {
  const enabled = (providers || []).filter((p) => p.enabled !== false);
  const available = enabled.filter((p) => p.available !== false);
  const target = available[0] || enabled[0];
  if (!target) {
    return { provider: '', mode: 'agent' };
  }
  const supported = target.supportedModes || ['ask', 'edit', 'agent'];
  const mode = supported.includes('agent') ? 'agent' : (target.defaultMode || 'edit');
  return { provider: target.id, mode };
}
