import {
  AiNotFoundError,
  AiUnsupportedOperationError,
  compareAiSessionsByActivity,
  validateAiMessage,
  validateAiSession,
} from './contracts.mjs';

const MOCK_CAPABILITIES = Object.freeze({
  listSessions: true,
  sessionMetadata: true,
  messages: true,
  createSession: true,
  startTurn: true,
  streamEvents: true,
  resumeTurn: false,
  resolveInteractions: true,
  cancelTurn: true,
});

const READ_ONLY_CAPABILITIES = Object.freeze({
  ...MOCK_CAPABILITIES,
  startTurn: false,
  resumeTurn: false,
  resolveInteractions: false,
  cancelTurn: false,
});

function isoAt(minutes) {
  return new Date(Date.UTC(2026, 7, 15, 8, minutes)).toISOString();
}

function padded(value) {
  return String(value).padStart(3, '0');
}

export class MockAiAdapter {
  #sessions = new Map();
  #messages = new Map();
  #createdCounter = 0;
  #messageCounter = 0;
  #clockTick = 0;

  constructor({ specId, taskIds = [] } = {}) {
    this.descriptor = Object.freeze({
      id: 'mock',
      label: 'Mock AI',
      enabled: true,
      capabilities: MOCK_CAPABILITIES,
    });
    if (specId) this.seedDemonstration({ specId, taskIds });
  }

  seedDemonstration({ specId, taskIds = [] }) {
    for (const [taskIndex, taskValue] of taskIds.entries()) {
      const taskId = typeof taskValue === 'string' ? taskValue : taskValue.id;
      for (let variant = 0; variant < 4; variant += 1) {
        const sessionId = `demo-${taskId}-${variant + 1}`;
        if (this.#sessions.has(sessionId)) continue;
        const completed = variant >= 2;
        const createdMinute = taskIndex * 20 + variant * 3;
        const session = validateAiSession({
          specId,
          provider: 'mock',
          sessionId,
          taskIds: [taskId],
          title: `${completed ? 'Completed' : 'Current'} ${taskId} conversation ${variant + 1}`,
          status: completed ? 'completed' : (variant === 0 ? 'waitingForUser' : 'idle'),
          createdAt: isoAt(createdMinute),
          lastActivityAt: isoAt(createdMinute + 2),
          ...(completed ? { completedAt: isoAt(createdMinute + 2) } : {}),
          capabilities: completed ? READ_ONLY_CAPABILITIES : MOCK_CAPABILITIES,
        });
        this.#sessions.set(sessionId, session);
        this.#messages.set(sessionId, [
          this.#fixtureMessage(`${sessionId}-m1`, 'user', `Help me with ${taskId}.`, createdMinute),
          this.#fixtureMessage(`${sessionId}-m2`, 'assistant', `I reviewed the requirements for ${taskId}.`, createdMinute + 1),
          this.#fixtureMessage(`${sessionId}-m3`, 'assistant', completed ? 'The demonstration task is complete.' : 'What would you like to do next?', createdMinute + 2),
        ]);
      }
    }
    return this;
  }

  async listSessions() {
    return [...this.#sessions.values()].map(session => structuredClone(session)).sort(compareAiSessionsByActivity);
  }

  async getSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new AiNotFoundError(`Mock session '${sessionId}' was not found.`, { provider: 'mock', sessionId });
    return structuredClone(session);
  }

  async listMessages(sessionId) {
    await this.getSession(sessionId);
    return (this.#messages.get(sessionId) || []).map(message => structuredClone(message));
  }

  async createSession({ specId, taskIds = [], title } = {}) {
    const sessionId = `session-${padded(++this.#createdCounter)}`;
    const createdAt = this.#nextTimestamp();
    const session = validateAiSession({
      specId,
      provider: 'mock',
      sessionId,
      taskIds,
      ...(title ? { title } : { title: `Mock session ${this.#createdCounter}` }),
      status: 'idle',
      createdAt,
      lastActivityAt: createdAt,
      capabilities: MOCK_CAPABILITIES,
    });
    this.#sessions.set(sessionId, session);
    this.#messages.set(sessionId, []);
    return structuredClone(session);
  }

  onTurnState({ sessionId, sessionStatus, timestamp }) {
    const session = this.#sessions.get(sessionId);
    if (!session || session.status === 'completed') return;
    session.status = sessionStatus;
    session.lastActivityAt = timestamp;
  }

  async startTurn({ sessionId, message, emitDelta, requestInteraction, signal, setOperation }) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new AiNotFoundError(`Mock session '${sessionId}' was not found.`);
    if (session.status === 'completed') throw new AiUnsupportedOperationError('mock', 'resumeTurn');
    const operation = { cancelled: false };
    setOperation(operation);
    this.#appendMessage(sessionId, 'user', message);

    const normalized = message.toLowerCase();
    const parts = ['I reviewed your message. ', 'This response is streaming in parts. '];
    let interactionSummary = '';
    emitDelta(parts[0], `assistant-${sessionId}-${this.#messageCounter + 1}`);
    await this.#yield(signal);

    if (normalized.includes('permission')) {
      const response = await requestInteraction({
        kind: 'permission',
        toolName: 'Shell',
        input: { command: 'npm --prefix tools/dashboard test' },
        details: 'Run the dashboard test suite.',
      });
      interactionSummary = response.decision === 'allow'
        ? 'Permission was allowed. '
        : `Permission was denied${response.message ? `: ${response.message}` : ''}. `;
    } else if (normalized.includes('question')) {
      const response = await requestInteraction({
        kind: 'question',
        questions: [
          {
            question: 'Which implementation style should the mock use?',
            header: 'Style',
            options: [
              { label: 'Focused', description: 'Keep the change narrowly scoped.' },
              { label: 'Detailed', description: 'Include more explanatory output.' },
            ],
            multiSelect: false,
          },
          {
            question: 'Which verification should run?',
            header: 'Checks',
            options: [
              { label: 'Tests', description: 'Run automated tests.' },
              { label: 'Build', description: 'Run the production build.' },
            ],
            multiSelect: true,
          },
        ],
      });
      interactionSummary = `Answers received: ${response.answers.map(answer => Array.isArray(answer.value) ? answer.value.join(', ') : answer.value).join('; ')}. `;
    }

    emitDelta(parts[1], `assistant-${sessionId}-${this.#messageCounter + 1}`);
    await this.#yield(signal);
    const ending = `${interactionSummary}The mock turn is complete.`;
    emitDelta(ending, `assistant-${sessionId}-${this.#messageCounter + 1}`);
    this.#appendMessage(sessionId, 'assistant', `${parts.join('')}${ending}`);
  }

  async cancelTurn({ operation }) {
    if (operation) operation.cancelled = true;
  }

  #appendMessage(sessionId, role, text) {
    const message = validateAiMessage({
      id: `mock-message-${padded(++this.#messageCounter)}`,
      role,
      text,
      createdAt: this.#nextTimestamp(),
    });
    this.#messages.get(sessionId).push(message);
    return message;
  }

  #fixtureMessage(id, role, text, minute) {
    return validateAiMessage({ id, role, text, createdAt: isoAt(minute) });
  }

  #nextTimestamp() {
    return new Date(Date.UTC(2026, 7, 15, 14, this.#clockTick++)).toISOString();
  }

  #yield(signal) {
    if (signal.aborted) return Promise.reject(new Error('Mock turn aborted.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 5);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Mock turn aborted.'));
      }, { once: true });
    });
  }
}

export function createMockAiAdapter(options) {
  return new MockAiAdapter(options);
}

export { MOCK_CAPABILITIES };
