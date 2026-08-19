// Markdown artifact verification gate implementation.

import nodeFs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GateContract, GateInspectionResult, GateVerificationResult } from './contracts.mjs';
import { resolveHumanScopeTarget } from './human-gate.mjs';
import { WorkflowError } from '../errors.mjs';

/**
 * Computes a deterministic SHA-256 digest of artifact contents.
 *
 * @param {string|Buffer} content
 * @returns {string} Hexadecimal SHA-256 hash
 */
export function computeArtifactHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

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
   * Retrieves recorded verification evidence for a specific markdown artifact version.
   *
   * @param {object} query
   * @param {string} query.scope - 'task' | 'step' | 'change'
   * @param {string} query.targetId - Identifier of target task/step/change
   * @param {string} query.file - Canonical repository-relative file path
   * @param {string} [query.artifactHash] - Deterministic SHA-256 hash of the artifact content
   * @returns {Promise<object|null>|object|null}
   */
  getEvidence(query) {
    throw new Error('MarkdownEvidenceReader.getEvidence() must be implemented');
  }
}

/**
 * In-memory implementation of MarkdownEvidenceReader for testing and composition.
 * Matches on target identity and returns the recorded evidence object.
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

  getEvidence({ scope, targetId, file }) {
    return (
      this._evidence.find((e) => {
        if (!e || typeof e !== 'object') return false;
        if (e.scope !== scope) return false;
        if (e.targetId !== targetId) return false;
        if (e.file !== file) return false;
        return true;
      }) || null
    );
  }
}

/**
 * Gate that verifies existence, structure, and trusted evidence of markdown verification artifacts.
 * Structurally inspecting text alone is read-only; explicit verification requires trusted evidence records bound to the exact content hash.
 */
export class MarkdownGate extends GateContract {
  /**
   * @param {object} [options={}]
   * @param {MarkdownEvidenceReader} [options.evidenceReader=null] - Trusted evidence reader (DI only)
   * @param {object} [options.fs=nodeFs] - Optional filesystem interface (DI only)
   */
  constructor({ evidenceReader = null, fs = nodeFs } = {}) {
    super();
    this._evidenceReader = evidenceReader;
    this._fs = fs;
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

    if (!this._fs.existsSync(filePath)) {
      return new GateInspectionResult({
        gateType: this.type,
        status: 'blocked',
        reason: 'artifact-missing',
        target: config.file,
        message: `Markdown verification artifact '${config.file}' does not exist`,
        details: { file: config.file, resolvedPath: filePath, exists: false },
      });
    }

    const content = this._fs.readFileSync(filePath, 'utf8');
    const artifactHash = computeArtifactHash(content);
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
          artifactHash,
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
        artifactHash,
        ...analysis,
      },
    });
  }

  /**
   * Explicitly evaluates and verifies markdown artifact completeness and trusted evidence bound to exact artifact content hash.
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
    const targetId = resolveHumanScopeTarget(scope, context);
    const file = config.file.trim();
    const artifactHash = inspection.details?.artifactHash;

    if (!targetId) {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Markdown verification for scope '${scope}' requires explicit target identity in context`,
        details: {
          file,
          scope,
          reason: 'missing-scope-identity',
          ...inspection.details,
        },
      });
    }

    // 2. Query trusted evidence reader
    const reader = this._evidenceReader;
    if (!reader || typeof reader.getEvidence !== 'function') {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Markdown artifact '${file}' is structurally complete, but no trusted evidence reader is configured`,
        details: {
          file,
          scope,
          targetId,
          artifactHash,
          reason: 'evidence-reader-missing',
          ...inspection.details,
        },
      });
    }

    let evidence = null;
    try {
      evidence = await reader.getEvidence({ scope, targetId, file, artifactHash });
    } catch (err) {
      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Failed to query markdown evidence reader: ${err.message}`,
        details: {
          file,
          scope,
          targetId,
          artifactHash,
          error: err.message,
          ...inspection.details,
        },
      });
    }

    // 3. Strict match validation against all expected fields
    const isVerified = evidence && typeof evidence === 'object' && evidence.verified === true;
    const scopeMatches = evidence?.scope === scope;
    const targetMatches = evidence?.targetId === targetId;
    const fileMatches = evidence?.file === file;
    const hashMatches = evidence?.artifactHash === artifactHash;

    if (!isVerified || !scopeMatches || !targetMatches || !fileMatches || !hashMatches) {
      let mismatchReason = 'evidence-required';
      if (evidence && !hashMatches) {
        mismatchReason = 'evidence-hash-mismatch';
      }

      return new GateVerificationResult({
        gateType: this.type,
        passed: false,
        status: 'blocked',
        message: `Markdown verification artifact '${file}' is structurally complete, but no matching verified evidence record exists for target '${targetId}' (hash: ${artifactHash ? artifactHash.slice(0, 8) : 'none'}...)`,
        details: {
          file,
          scope,
          targetId,
          artifactHash,
          reason: mismatchReason,
          recordedEvidence: evidence || null,
          ...inspection.details,
        },
      });
    }

    return new GateVerificationResult({
      gateType: this.type,
      passed: true,
      status: 'passed',
      message: `Markdown artifact '${file}' is verified with authoritative evidence for '${targetId}' (hash: ${artifactHash.slice(0, 8)}...)`,
      details: {
        file,
        scope,
        targetId,
        artifactHash,
        evidence,
        ...inspection.details,
      },
    });
  }
}
