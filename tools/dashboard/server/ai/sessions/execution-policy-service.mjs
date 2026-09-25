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

  const hasTopLevelProvider = typeof policy.provider === 'string' && policy.provider.trim().length > 0;
  const hasDefaultProvider =
    policy.default &&
    typeof policy.default === 'object' &&
    typeof policy.default.provider === 'string' &&
    policy.default.provider.trim().length > 0;

  if (!hasTopLevelProvider && !hasDefaultProvider) {
    throw new AiValidationError('Execution policy provider must be a non-empty string.');
  }

  if (policy.provider !== undefined && (typeof policy.provider !== 'string' || !policy.provider.trim())) {
    throw new AiValidationError('Execution policy provider must be a non-empty string.');
  }
  if (policy.mode !== undefined && (typeof policy.mode !== 'string' || !policy.mode.trim())) {
    throw new AiValidationError('Execution policy mode must be a non-empty string.');
  }

  if (policy.default !== undefined) {
    if (!policy.default || typeof policy.default !== 'object' || Array.isArray(policy.default)) {
      throw new AiValidationError('Execution policy default must be an object.');
    }
    if (typeof policy.default.provider !== 'string' || !policy.default.provider.trim()) {
      throw new AiValidationError('Execution policy default.provider must be a non-empty string.');
    }
    if (policy.default.mode !== undefined && (typeof policy.default.mode !== 'string' || !policy.default.mode.trim())) {
      throw new AiValidationError('Execution policy default.mode must be a non-empty string.');
    }
  }

  if (policy.roles !== undefined) {
    if (!policy.roles || typeof policy.roles !== 'object' || Array.isArray(policy.roles)) {
      throw new AiValidationError('Execution policy roles must be an object.');
    }
    for (const [role, roleConfig] of Object.entries(policy.roles)) {
      if (!roleConfig || typeof roleConfig !== 'object' || Array.isArray(roleConfig)) {
        throw new AiValidationError(`roles['${role}'] must be an object.`);
      }
      if (typeof roleConfig.provider !== 'string' || !roleConfig.provider.trim()) {
        throw new AiValidationError(`roles['${role}'].provider must be a non-empty string.`);
      }
      if (roleConfig.mode !== undefined && (typeof roleConfig.mode !== 'string' || !roleConfig.mode.trim())) {
        throw new AiValidationError(`roles['${role}'].mode must be a non-empty string.`);
      }
    }
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

    const defaultProvider = (policy.provider || policy.default?.provider || '').trim();
    const defaultMode = (policy.mode || policy.default?.mode || 'agent').trim();

    const normalized = {
      provider: defaultProvider,
      mode: defaultMode,
      ...(policy.default
        ? {
            default: {
              provider: (policy.default.provider || defaultProvider).trim(),
              mode: (policy.default.mode || defaultMode).trim(),
            },
          }
        : {}),
      ...(policy.roles
        ? {
            roles: Object.fromEntries(
              Object.entries(policy.roles).map(([r, conf]) => [
                r,
                {
                  provider: conf.provider.trim(),
                  mode: (conf.mode || defaultMode).trim(),
                },
              ]),
            ),
          }
        : {}),
      ...(policy.taskOverrides ? { taskOverrides: policy.taskOverrides } : {}),
    };

    const tempFile = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tempFile, JSON.stringify(normalized, null, 2), 'utf8');
    renameSync(tempFile, file);
    return normalized;
  }

  resolveExecutionPolicy(changeSlug, taskIdOrOptions = null, maybeOptions = {}) {
    let taskId = null;
    let role = null;
    let repoRoot = this.repoRoot;

    if (typeof taskIdOrOptions === 'object' && taskIdOrOptions !== null) {
      taskId = taskIdOrOptions.taskId || null;
      role = taskIdOrOptions.role || null;
      if (taskIdOrOptions.repoRoot) repoRoot = taskIdOrOptions.repoRoot;
    } else {
      taskId = taskIdOrOptions;
      if (typeof maybeOptions === 'object' && maybeOptions !== null) {
        role = maybeOptions.role || null;
        if (maybeOptions.repoRoot) repoRoot = maybeOptions.repoRoot;
      }
    }

    const policy = this.getExecutionPolicy(changeSlug, { repoRoot });
    if (!policy) return null;

    const defaultProvider = policy.default?.provider || policy.provider;
    const defaultMode = policy.default?.mode || policy.mode;

    // 1. Task override has highest priority
    if (taskId && policy.taskOverrides?.[taskId]) {
      const override = policy.taskOverrides[taskId];
      return {
        provider: override.provider || defaultProvider,
        mode: override.mode || defaultMode,
      };
    }

    // 2. Role-specific policy (e.g. implementer, reviewer, refiner)
    if (role && policy.roles?.[role]) {
      const roleConf = policy.roles[role];
      return {
        provider: roleConf.provider || defaultProvider,
        mode: roleConf.mode || defaultMode,
      };
    }

    // 3. Fallback to change-level default
    return {
      provider: defaultProvider,
      mode: defaultMode,
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
