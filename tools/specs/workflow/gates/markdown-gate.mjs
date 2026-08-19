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
 * Gate that verifies existence and completeness of markdown verification artifacts.
 */
export class MarkdownGate extends GateContract {
  get type() {
    return 'markdown';
  }

  /**
   * Resolves target file path.
   *
   * @param {object} config
   * @param {object} context
   * @returns {string}
   */
  _resolveFilePath(config, context = {}) {
    if (!config?.file || typeof config.file !== 'string' || !config.file.trim()) {
      throw new WorkflowError("MarkdownGate configuration requires a non-empty string 'file'");
    }
    const relativePath = config.file.trim();
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    const root = context.repoRoot || process.cwd();
    return path.resolve(root, relativePath);
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
