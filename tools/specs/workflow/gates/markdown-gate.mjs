// Markdown artifact verification gate implementation.

import fs from 'node:fs';
import path from 'node:path';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { WorkflowError } from '../errors.mjs';

/**
 * Parses markdown checklist and section completeness.
 *
 * @param {string} content - Markdown file content
 * @param {string[]} [requiredSections=[]] - Required section header titles
 * @returns {{ complete: boolean, incompleteChecklistItems: string[], completedChecklistItems: string[], missingSections: string[] }}
 */
export function analyzeMarkdownArtifact(content, requiredSections = []) {
  const lines = content.split(/\r?\n/);
  const incompleteChecklistItems = [];
  const completedChecklistItems = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const incompleteMatch = trimmed.match(/^[-*]\s+\[\s\]\s+(.*)$/);
    if (incompleteMatch) {
      incompleteChecklistItems.push(incompleteMatch[1]);
      continue;
    }

    const completeMatch = trimmed.match(/^[-*]\s+\[[xX]\]\s+(.*)$/);
    if (completeMatch) {
      completedChecklistItems.push(completeMatch[1]);
    }
  }

  const missingSections = [];
  for (const section of requiredSections) {
    const headerRegex = new RegExp(`^#{1,6}\\s+.*${section.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}.*$`, 'mi');
    if (!headerRegex.test(content)) {
      missingSections.push(section);
    }
  }

  const complete = incompleteChecklistItems.length === 0 && missingSections.length === 0;
  return {
    complete,
    incompleteChecklistItems,
    completedChecklistItems,
    missingSections,
  };
}

/**
 * Gate that verifies existence and completeness of markdown verification artifacts strictly within the repository.
 */
export class MarkdownGate extends GateContract {
  get type() {
    return 'markdown';
  }

  /**
   * Resolves target file path ensuring it remains strictly inside repoRoot.
   *
   * @param {object} config
   * @param {object} [context={}]
   * @returns {string}
   * @throws {WorkflowError} If path is absolute or attempts traversal outside repoRoot
   */
  _resolveFilePath(config, context = {}) {
    if (!config?.file || typeof config.file !== 'string' || !config.file.trim()) {
      throw new WorkflowError("MarkdownGate configuration requires a non-empty string 'file'");
    }
    const relativePath = config.file.trim();

    // Reject absolute paths (POSIX and Windows drive letters)
    if (path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath) || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      throw new WorkflowError(
        `Absolute paths are forbidden for markdown verification artifacts: '${relativePath}'. Artifacts must be repository-relative paths.`,
        { code: 'PATH_TRAVERSAL_FORBIDDEN', requested: relativePath }
      );
    }

    // Reject explicit path traversal indicators
    if (relativePath.includes('..')) {
      throw new WorkflowError(
        `Path traversal sequences ('..') are forbidden in markdown artifact paths: '${relativePath}'.`,
        { code: 'PATH_TRAVERSAL_FORBIDDEN', requested: relativePath }
      );
    }

    const root = path.resolve(context.repoRoot || process.cwd());
    const resolvedPath = path.resolve(root, relativePath);
    const normalizedRoot = path.normalize(root);
    const normalizedPath = path.normalize(resolvedPath);

    // Verify containment strictly under repository root
    const isInside = normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + path.sep);
    if (!isInside) {
      throw new WorkflowError(
        `Markdown artifact path '${relativePath}' escapes the repository root '${root}'.`,
        { code: 'PATH_TRAVERSAL_FORBIDDEN', requested: relativePath, resolvedPath }
      );
    }

    return normalizedPath;
  }

  /**
   * Introspects markdown artifact status without modifying state.
   *
   * @param {object} config
   * @param {object} [context={}]
   * @returns {Promise<GateInspectionResult>}
   */
  async inspect(config, context = {}) {
    const filePath = this._resolveFilePath(config, context);

    if (context.fs?.existsSync ? !context.fs.existsSync(filePath) : !fs.existsSync(filePath)) {
      return new GateInspectionResult({
        gateType: this.type,
        status: 'blocked',
        reason: 'artifact-missing',
        target: config.file,
        message: `Markdown verification artifact '${config.file}' does not exist`,
        details: { file: config.file, resolvedPath: filePath, exists: false },
      });
    }

    const content = context.fs?.readFileSync
      ? context.fs.readFileSync(filePath, 'utf8')
      : fs.readFileSync(filePath, 'utf8');

    const analysis = analyzeMarkdownArtifact(content, config.requiredSections || []);

    if (!analysis.complete) {
      const reasons = [];
      if (analysis.incompleteChecklistItems.length > 0) {
        reasons.push(`${analysis.incompleteChecklistItems.length} incomplete checklist item(s)`);
      }
      if (analysis.missingSections.length > 0) {
        reasons.push(`missing required section(s): [${analysis.missingSections.join(', ')}]`);
      }

      return new GateInspectionResult({
        gateType: this.type,
        status: 'blocked',
        reason: 'artifact-incomplete',
        target: config.file,
        message: `Markdown artifact '${config.file}' is incomplete: ${reasons.join(', ')}`,
        details: {
          file: config.file,
          exists: true,
          ...analysis,
        },
      });
    }

    return new GateInspectionResult({
      gateType: this.type,
      status: 'passed',
      target: config.file,
      message: `Markdown artifact '${config.file}' is verified and complete`,
      details: {
        file: config.file,
        exists: true,
        ...analysis,
      },
    });
  }

  /**
   * Explicitly evaluates and verifies markdown artifact completeness.
   *
   * @param {object} config
   * @param {object} [context={}]
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context = {}) {
    const inspection = await this.inspect(config, context);
    const passed = inspection.status === 'passed';

    return new GateVerificationResult({
      gateType: this.type,
      passed,
      status: passed ? 'passed' : 'blocked',
      message: inspection.message,
      details: inspection.details,
    });
  }
}
