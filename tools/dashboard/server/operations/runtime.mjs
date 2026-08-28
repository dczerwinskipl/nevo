// tools/dashboard/server/operations/runtime.mjs — operation runtime, snapshot & resumable SSE transport

import { randomUUID } from 'node:crypto';
import { parseProgressLine } from '../../../lib/operation-progress.mjs';

export class OperationNotFoundError extends Error {
  constructor(operationId) {
    super(`Operation '${operationId}' not found.`);
    this.name = 'OperationNotFoundError';
    this.status = 404;
  }
}

export class OperationRuntime {
  #operations = new Map();
  #terminalOrder = [];
  #closed = false;

  constructor({
    maxEventsPerOperation = 500,
    maxRetainedOperations = 100,
    idFactory = randomUUID,
    clock = () => new Date(),
  } = {}) {
    this.maxEventsPerOperation = maxEventsPerOperation;
    this.maxRetainedOperations = maxRetainedOperations;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  createOperation({ type = 'operation', steps = [] } = {}) {
    if (this.#closed) {
      const error = new Error('The operation runtime is shut down.');
      error.status = 503;
      throw error;
    }
    const operationId = `op-${this.idFactory()}`;
    const initialSteps = steps.map(s => ({
      id: s.id,
      label: s.label || s.id,
      status: s.status || 'pending',
      ...(s.total !== undefined ? { total: s.total } : {}),
      ...(s.current !== undefined ? { current: s.current } : {}),
    }));

    const state = {
      id: operationId,
      type,
      status: 'running',
      startedAt: this.#timestamp(),
      completedAt: undefined,
      sequence: 0,
      steps: initialSteps,
      events: [],
      subscribers: new Set(),
      result: undefined,
      error: undefined,
    };

    this.#operations.set(operationId, state);
    this.#emit(state, 'operation.started', {
      operationType: type,
      steps: initialSteps,
    });
    return operationId;
  }

  recordEvent(operationId, rawEvent) {
    const state = this.#operations.get(operationId);
    if (!state || this.#isTerminal(state)) return null;

    const event = typeof rawEvent === 'string' ? parseProgressLine(rawEvent) : rawEvent;
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null;

    const stepId = event.id || event.stepId;

    switch (event.type) {
      case 'operation.started': {
        if (Array.isArray(event.steps) && event.steps.length) {
          state.steps = event.steps.map(s => ({
            id: s.id,
            label: s.label || s.id,
            status: s.status || 'pending',
            ...(s.total !== undefined ? { total: s.total } : {}),
            ...(s.current !== undefined ? { current: s.current } : {}),
          }));
        }
        break;
      }
      case 'operation.step.started': {
        let step = state.steps.find(s => s.id === stepId);
        if (!step) {
          step = { id: stepId, label: event.label || stepId, status: 'running' };
          state.steps.push(step);
        } else {
          step.status = 'running';
          if (event.label) step.label = event.label;
        }
        if (event.total !== undefined) step.total = event.total;
        break;
      }
      case 'operation.step.progress': {
        const step = state.steps.find(s => s.id === stepId);
        if (step) {
          if (event.current !== undefined) step.current = event.current;
          if (event.total !== undefined) step.total = event.total;
          if (event.detail !== undefined) step.detail = event.detail;
        }
        break;
      }
      case 'operation.step.completed': {
        let step = state.steps.find(s => s.id === stepId);
        if (!step) {
          step = { id: stepId, label: stepId, status: 'completed' };
          state.steps.push(step);
        } else {
          step.status = 'completed';
          if (event.detail !== undefined) step.detail = event.detail;
        }
        break;
      }
      case 'operation.step.failed': {
        let step = state.steps.find(s => s.id === stepId);
        const errorObj = typeof event.error === 'string' ? { message: event.error } : (event.error || { message: 'Step failed' });
        if (!step) {
          step = { id: stepId, label: stepId, status: 'failed', error: errorObj };
          state.steps.push(step);
        } else {
          step.status = 'failed';
          step.error = errorObj;
          if (event.detail !== undefined) step.detail = event.detail;
        }
        break;
      }
      case 'operation.completed': {
        this.completeOperation(operationId, event.result, event.summary);
        return null;
      }
      case 'operation.failed': {
        this.failOperation(operationId, event.error, event.summary);
        return null;
      }
      default:
        break;
    }

    return this.#emit(state, event.type, { ...event, stepId });
  }

  completeOperation(operationId, result = null, summary = null) {
    const state = this.#operations.get(operationId);
    if (!state || this.#isTerminal(state)) return;

    state.status = 'completed';
    state.completedAt = this.#timestamp();
    state.result = result;
    this.#emit(state, 'operation.completed', {
      ...(result !== null && result !== undefined ? { result } : {}),
      ...(summary !== null && summary !== undefined ? { summary } : {}),
    });
    this.#finalize(state);
  }

  failOperation(operationId, error = null, summary = null) {
    const state = this.#operations.get(operationId);
    if (!state || this.#isTerminal(state)) return;

    const errorObj = typeof error === 'string'
      ? { message: error }
      : (error && typeof error === 'object' ? { message: error.message || String(error), code: error.code } : { message: 'Operation failed' });

    state.status = 'failed';
    state.completedAt = this.#timestamp();
    state.error = errorObj;

    for (const step of state.steps) {
      if (step.status === 'running') {
        step.status = 'failed';
        if (!step.error) {
          step.error = errorObj;
        }
      }
    }

    this.#emit(state, 'operation.failed', {
      error: errorObj,
      ...(summary !== null && summary !== undefined ? { summary } : {}),
    });
    this.#finalize(state);
  }

  getSnapshot(operationId) {
    const state = this.#get(operationId);
    return {
      id: state.id,
      type: state.type,
      status: state.status,
      startedAt: state.startedAt,
      ...(state.completedAt ? { completedAt: state.completedAt } : {}),
      lastEventId: state.sequence,
      steps: state.steps.map(s => structuredClone(s)),
      ...(state.result !== undefined ? { result: structuredClone(state.result) } : {}),
      ...(state.error !== undefined ? { error: structuredClone(state.error) } : {}),
      events: state.events.map(e => structuredClone(e)),
    };
  }

  getEvents(operationId, afterSequence = 0) {
    const state = this.#get(operationId);
    const cursor = Number(afterSequence) || 0;
    return state.events.filter(e => e.id > cursor).map(e => structuredClone(e));
  }

  subscribe(operationId, { afterSequence = 0, onEvent } = {}) {
    const state = this.#get(operationId);
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
    for (const event of this.getEvents(operationId, afterSequence)) {
      onEvent(event);
    }
    if (!this.#isTerminal(state)) {
      state.subscribers.add(onEvent);
    }
    return () => state.subscribers.delete(onEvent);
  }

  shutdown() {
    if (this.#closed) return;
    this.#closed = true;
    for (const state of this.#operations.values()) {
      if (this.#isTerminal(state)) continue;
      this.failOperation(state.id, { message: 'The server stopped before the operation completed.', code: 'OPERATION_INTERRUPTED' });
    }
  }

  #emit(state, type, data = {}) {
    const sequence = ++state.sequence;
    const cloned = structuredClone(data);
    if (cloned.id !== undefined && typeof cloned.id === 'string') {
      cloned.stepId = cloned.id;
    }
    const event = {
      ...cloned,
      id: sequence,
      type,
      operationId: state.id,
      timestamp: this.#timestamp(),
    };
    state.events.push(event);
    if (state.events.length > this.maxEventsPerOperation) state.events.shift();
    for (const subscriber of state.subscribers) {
      subscriber(structuredClone(event));
    }
    return event;
  }

  #finalize(state) {
    state.subscribers.clear();
    this.#terminalOrder.push(state.id);
    while (this.#terminalOrder.length > this.maxRetainedOperations) {
      const evicted = this.#terminalOrder.shift();
      this.#operations.delete(evicted);
    }
  }

  #timestamp() {
    const value = this.clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  #get(operationId) {
    const state = this.#operations.get(operationId);
    if (!state) throw new OperationNotFoundError(operationId);
    return state;
  }

  #isTerminal(state) {
    return state.status === 'completed' || state.status === 'failed';
  }
}

export function createOperationRuntime(options) {
  return new OperationRuntime(options);
}
