// Markdown artifact verification gate implementation.

import fs from 'node:fs';
import path from 'node:path';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { resolveHumanScopeTarget } from './human-gate.mjs';
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
 * Abstract reader interface for accessing trusted recorded markdown verification evidence.
 */
export class MarkdownEvidenceReader {
  /**
   * Retrieves recorded verification evidence for a markdown artifact.
   *
   * @param {object} query
   * @param {string} query.scope - 'task' | 'step' | 'change'
   * @param {string} query.targetId - Identifier of target
   * @param {string} query.artifactPath - Absolute normalized file path
   * @param {string} query.file - Configured relative file path
   * @returns {Promise<object|null>|object|null}
   */
  getEvidence(query) {
    throw new Error('MarkdownEvidenceReader.getEvidence() must be implemented');
  }
}

/**
 * In-memory implementation of MarkdownEvidenceReader for testing and composition.
 */
export class MemoryMarkdownEvidenceReader extends MarkdownEvidenceReader {
  /**
   * @param {Array<object>} [evidenceList=[]]
   */
  constructor(evidenceList = []) {
    super();
    this._evidence = Array.isArray(evidenceList) ? [...evidenceList] : [];
  }

  /**
   * Records verification evidence in memory.
   * @param {object} evidence
   */
  addEvidence(evidence) {
    if (evidence && typeof evidence === 'object') {
      this._evidence.push(evidence);
    }
  }

  getEvidence({ scope, targetId, artifactPath, file }) {
    return (
      this._evidence.find((e) => {
        if (!e || typeof e !== 'object' || e.verified !== true) return false;
        if (targetId && e.targetId && e.targetId !== targetId) return false;
        if (scope && e.scope && e.scope !== scope) return false;
        if (artifactPath && e.artifactPath && e.artifactPath !== artifactPath && e.file !== file) return false;
        return true;
      }) || null
    );
  }
}

/**
 * Gate that verifies existence, structure, and trusted evidence of markdown verification artifacts.
 * Structurally inspecting text alone is read-only; explicit verification requires trusted evidence records.
 */
export class MarkdownGate extends GateContract {
  /**
   * @param {object} [options={}]
   * @param {MarkdownEvidenceReader} [options.evidenceReader=null] - Trusted evidence reader (DI only)
   */
  constructor({ evidenceReader = null } = {}) {
    super();
    this._evidenceReader = evidenceReader;
  }

  get type() {
    return 'markdown';
  }

  /**
   * Resolves target file path ensuring it remains strictly inside repoRoot.
   * Requires explicit context.repoRoot.
   *
   * @param {object} config
   * @param {object} [context={}]
   * @returns {string}
   * @throws {WorkflowError} If repoRoot is missing, or path is absolute, or attempts traversal
   */
  _resolveFilePath(config, context = {}) {
    if (!config?.file || typeof config.file !== 'string' || !config.file.trim()) {
      throw new WorkflowError("MarkdownGate configuration requires a non-empty string 'file'");
    }

    if (!context.repoRoot || typeof context.repoRoot !== 'string' || !context.repoRoot.trim()) {
      throw new WorkflowError(
        "MarkdownGate file resolution requires explicit 'context.repoRoot'",
        { code: 'MISSING_REPO_ROOT', requested: config.file }
      );
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

    const root = path.resolve(context.repoRoot.trim());
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
   * Introspects markdown artifact structure and checklist completeness without modifying state.
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
      message: `Markdown artifact '${config.file}' is structurally valid and complete`,
      details: {
        file: config.file,
        exists: true,
        ...analysis,
      },
    });
  }

  /**
   * Explicitly evaluates and verifies markdown artifact completeness and trusted evidence.
   * Reading mutable markdown checkboxes alone cannot self-satisfy verification without a trusted evidence record.
   *
   * @param {object} config
   * @param {object} [context={}]
   * @returns {Promise<GateVerificationResult>}
   */
  async verify(config, context = {}) {
    // 1. Structural inspection check
    const inspection = await this.inspect(config, context);
    if (inspection.status !== 'passed') {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: inspection.message,
        details: inspection.details,
      });
    }

    const scope = config.scope || 'task';
    const targetId = resolveHumanScopeTarget(scope, context) || config.file;
    const artifactPath = this._resolveFilePath(config, context);

    // 2. Query trusted evidence reader (cannot be satisfied by editing checkboxes in repository files)
    const reader = this._evidenceReader;
    if (!reader || typeof reader.getEvidence !== 'function') {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Markdown artifact '${config.file}' is structurally complete, but no trusted evidence reader is configured`,
        details: {
          file: config.file,
          targetId,
          reason: 'evidence-reader-missing',
          ...inspection.details,
        },
      });
    }

    let evidence = null;
    try {
      evidence = await reader.getEvidence({ scope, targetId, artifactPath, file: config.file });
    } catch (err) {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Failed to query markdown evidence reader: ${err.message}`,
        details: {
          file: config.file,
          targetId,
          error: err.message,
          ...inspection.details,
        },
      });
    }

    const isVerified = evidence && typeof evidence === 'object' && evidence.verified === true;
    if (!isVerified) {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Markdown verification artifact '${config.file}' is structurally complete, but no verified evidence record exists for target '${targetId}'`,
        details: {
          file: config.file,
          targetId,
          reason: 'evidence-required',
          evidence: null,
          ...inspection.details,
        },
      });
    }

    return new GateVerificationResult({
      gateType: this.type,
      passed: true,
      status: 'passed',
      message: `Markdown artifact '${config.file}' is verified with authoritative evidence for '${targetId}'`,
      details: {
        file: config.file,
        targetId,
        evidence,
        ...inspection.details,
      },
    });
  }
}
