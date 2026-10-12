// Pure domain batch-reservation entry point (Task 28, D33, D38, D46; queue removed in
// batch-execution-generalization, task 01 — the plain sequential queue had no caller
// single-task Start/continuation actually needed).
// Zero AI/session/dashboard awareness.

export {
  validateBatchCompatibility,
  createGroupReservation,
  releaseGroupReservation,
  rollbackReservationSynchronously,
  listGroupReservations,
  getGroupReservation,
  isTaskBarriered,
  getTaskReservation,
  assessBatchReservationSettlement,
  reconcileCrashedReservation,
} from './reservation.mjs';
