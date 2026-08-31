export type OperationStatus = 'running' | 'completed' | 'failed';
export type OperationStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface OperationStep {
  id: string;
  label: string;
  status: OperationStepStatus;
  current?: number;
  total?: number;
  detail?: string;
  error?: { message: string; code?: string };
}

export interface OperationEvent {
  id: number;
  type: string;
  operationId: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface OperationSnapshot {
  id: string;
  type: string;
  status: OperationStatus;
  startedAt: string;
  completedAt?: string;
  lastEventId: number;
  steps: OperationStep[];
  result?: unknown;
  error?: { message: string; code?: string };
  events: OperationEvent[];
}
