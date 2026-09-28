// Batch-finish operation entry point (Task 04).
// Pure workflow domain logic: zero dashboard imports.

export { executeBatchFinish } from './operation.mjs';
export {
  createBatchFinishRecord,
  loadBatchFinishRecord,
  saveBatchFinishRecord,
  updateBatchFinishRecord,
  getBatchFinishDir,
  getBatchFinishRecordPath,
} from './record.mjs';
export {
  prevalidateBatchFinish,
  verifyTrustedIdentity,
  extractTaskResults,
  computeDeltaFingerprint,
  fingerprintsEqual,
  loadPersistedSessionSync,
} from './preflight.mjs';
