// Batch Report Renderer (Task 05, D7, D11, D32).
// Pure Markdown rendering of the final BatchContext.
// Builds nothing: no context resolution, no overlap detection, no Git commit calls.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Returns the canonical relative report path for a batch execution.
 * Format: `specs/active/<change>/reviews/review-batch-<batchExecutionId>.md` (D11, D22, D30).
 *
 * @param {string} changeSlug
 * @param {string} batchExecutionId
 * @returns {string}
 */
export function getCanonicalBatchReportRelativePath(changeSlug, batchExecutionId) {
  return `specs/active/${changeSlug}/reviews/review-batch-${batchExecutionId}.md`;
}

/**
 * Normalizes text to standard Unix line endings (LF).
 */
function normalizeLf(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\r\n/g, '\n');
}

/**
 * Renders the final BatchContext into the canonical shared batch report Markdown string (D11, D32).
 * Deterministic and byte-identical across repeat runs.
 *
 * @param {object} batchContext - Final BatchContext from batch-start-and-context-bootstrap
 * @param {object} [options]
 * @param {object} [options.results] - Optional per-task verdicts/feedback
 * @returns {string} Markdown report content
 */
export function renderBatchReport(batchContext = {}, options = {}) {
  const {
    batchExecutionId = 'unknown-batch',
    change = 'unknown-change',
    targetStep = 'review',
    executionScope,
    members = [],
    crossTask = {},
    predecessorSessions = [],
    requiredContext = [],
    relevantDocs = [],
    results: contextResults = {},
  } = batchContext;

  const results = options.results || contextResults || {};
  const taskIds = executionScope?.taskIds || members.map(m => m.taskId);
  const sortedTaskIds = [...taskIds].sort();

  const lines = [];

  // 1. Header
  lines.push(`# Batch Review Report: ${batchExecutionId}`);
  lines.push('');
  lines.push(`- **Change:** ${change}`);
  lines.push(`- **Target Step:** ${targetStep}`);
  lines.push(`- **Tasks in Scope:** ${sortedTaskIds.join(', ')}`);
  lines.push('');

  // 2. Cross-task findings section (D11)
  lines.push('## Cross-task findings');
  lines.push('');

  const findings = Array.isArray(crossTask.findings)
    ? [...crossTask.findings]
    : (Array.isArray(batchContext.crossTaskFindings) ? [...batchContext.crossTaskFindings] : []);

  if (findings.length === 0) {
    lines.push('No cross-task conflicts or integration issues detected.');
    lines.push('');
  } else {
    // Sort findings deterministically
    findings.sort((a, b) => {
      const idA = a.id || a.sharedPath || a.path || '';
      const idB = b.id || b.sharedPath || b.path || '';
      return String(idA).localeCompare(String(idB));
    });

    for (const [idx, finding] of findings.entries()) {
      const findingId = finding.id || `Finding-${idx + 1}`;
      lines.push(`### ${findingId}`);
      lines.push('');

      const affected = Array.isArray(finding.affectedTaskIds)
        ? [...finding.affectedTaskIds].sort()
        : (Array.isArray(finding.tasks) ? [...finding.tasks].sort() : (Array.isArray(finding.taskIds) ? [...finding.taskIds].sort() : []));

      lines.push(`- **Affected Tasks:** ${affected.join(', ')}`);

      if (finding.message || finding.description) {
        lines.push(`- **Message:** ${finding.message || finding.description}`);
      }
      if (finding.severity) {
        lines.push(`- **Severity:** ${finding.severity}`);
      }
      if (finding.sharedPath || finding.path) {
        lines.push(`- **Path:** \`${finding.sharedPath || finding.path}\``);
      }
      if (Array.isArray(finding.paths) && finding.paths.length > 0) {
        lines.push('- **Paths:**');
        for (const p of [...finding.paths].sort()) {
          lines.push(`  - \`${p}\``);
        }
      }
      lines.push('');
    }
  }

  // 3. Per-task sections (sorted by order asc, then taskId asc)
  const sortedMembers = [...members].sort((a, b) => {
    const orderA = a.order ?? 999;
    const orderB = b.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.taskId).localeCompare(String(b.taskId));
  });

  const lineageMap = new Map();
  for (const p of predecessorSessions) {
    if (p.taskId) lineageMap.set(p.taskId, p);
  }

  for (const m of sortedMembers) {
    const taskId = m.taskId;
    const titlePart = m.title ? ` - ${m.title}` : '';
    lines.push(`## Task: ${taskId}${titlePart}`);
    lines.push('');
    lines.push(`- **Order:** ${m.order ?? 0}`);
    lines.push(`- **Status:** ${m.status || 'unknown'}`);

    const lineage = lineageMap.get(taskId);
    if (lineage) {
      const priorStepPart = lineage.priorStep ? ` (prior step: ${lineage.priorStep}${lineage.priorAttempt ? `, attempt: ${lineage.priorAttempt}` : ''})` : '';
      lines.push(`- **Predecessor Session:** ${lineage.sessionId || 'none'}${priorStepPart}`);
    }

    if (Array.isArray(m.allowedPaths) && m.allowedPaths.length > 0) {
      lines.push('- **Allowed Paths:**');
      for (const p of [...m.allowedPaths].sort()) {
        lines.push(`  - \`${p}\``);
      }
    }

    const taskResult = results[taskId];
    const verdict = typeof taskResult === 'string'
      ? taskResult
      : (taskResult?.verdict || taskResult?.result || 'Pending');
    const feedback = typeof taskResult === 'object' && taskResult?.feedback
      ? taskResult.feedback
      : 'None';

    lines.push('');
    lines.push('### Verdict');
    lines.push('');
    lines.push(verdict);
    lines.push('');
    lines.push('### Feedback');
    lines.push('');
    lines.push(feedback);
    lines.push('');
  }

  // 4. Shared Context Attribution (if present)
  const hasRequiredContext = Array.isArray(requiredContext) && requiredContext.length > 0;
  const hasRelevantDocs = Array.isArray(relevantDocs) && relevantDocs.length > 0;

  if (hasRequiredContext || hasRelevantDocs) {
    lines.push('## Shared Context Attribution');
    lines.push('');

    if (hasRequiredContext) {
      lines.push('### Required Context');
      lines.push('');
      const sortedReq = [...requiredContext].sort((a, b) => {
        const keyA = typeof a === 'string' ? a : (a.path || a.id || a.value || JSON.stringify(a));
        const keyB = typeof b === 'string' ? b : (b.path || b.id || b.value || JSON.stringify(b));
        return keyA.localeCompare(keyB);
      });

      for (const req of sortedReq) {
        const itemVal = typeof req === 'string' ? req : (req.path || req.id || req.value || 'unknown');
        const usedBy = Array.isArray(req.usedBy) ? [...req.usedBy].sort().join(', ') : 'unknown';
        lines.push(`- \`${itemVal}\` (used by: ${usedBy})`);
      }
      lines.push('');
    }

    if (hasRelevantDocs) {
      lines.push('### Relevant Documentation');
      lines.push('');
      const sortedDocs = [...relevantDocs].sort((a, b) => {
        const keyA = typeof a === 'string' ? a : (a.ref || a.path || a.url || a.value || JSON.stringify(a));
        const keyB = typeof b === 'string' ? b : (b.ref || b.path || b.url || b.value || JSON.stringify(b));
        return keyA.localeCompare(keyB);
      });

      for (const doc of sortedDocs) {
        const docVal = typeof doc === 'string' ? doc : (doc.ref || doc.path || doc.url || doc.value || 'unknown');
        const usedBy = Array.isArray(doc.usedBy) ? [...doc.usedBy].sort().join(', ') : 'unknown';
        lines.push(`- \`${docVal}\` (used by: ${usedBy})`);
      }
      lines.push('');
    }
  }

  return normalizeLf(lines.join('\n'));
}

/**
 * Writes the rendered canonical shared batch report to disk (D11, D32).
 * Writes content only — no Git commit call is made (D22, D30).
 *
 * @param {object} batchContext - Final BatchContext from batch-start-and-context-bootstrap
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {string} [options.outputPath]
 * @param {object} [options.results]
 * @returns {{ reportPath: string, fullPath: string, content: string }}
 */
export function writeBatchReport(batchContext = {}, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const changeSlug = batchContext.change || 'unknown-change';
  const batchExecutionId = batchContext.batchExecutionId || 'unknown-batch';
  const content = renderBatchReport(batchContext, options);

  const relativePath = options.outputPath || getCanonicalBatchReportRelativePath(changeSlug, batchExecutionId);
  const fullPath = path.isAbsolute(relativePath) ? relativePath : path.join(repoRoot, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');

  return {
    reportPath: relativePath.replace(/\\/g, '/'),
    fullPath,
    content,
  };
}
