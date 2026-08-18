import {
  AiValidationError,
} from './contracts.mjs';


const MOCK_CAPABILITIES = Object.freeze({
  interactivePermissions: true,
  interactiveQuestions: true,
  interactiveConfirmations: true,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
});

function padded(value) {
  return String(value).padStart(3, '0');
}

export class MockAiAdapter {
  #createdCounter = 0;
  #streamDelayMs;

  constructor({ streamDelayMs = 20 } = {}) {
    this.#streamDelayMs = streamDelayMs;
    this.descriptor = Object.freeze({
      id: 'mock',
      label: 'Mock AI',
      enabled: true,
      capabilities: MOCK_CAPABILITIES,
    });
  }

  isAvailable() {
    return { available: true };
  }

  async startTurn({
    turnId,
    providerSessionId,
    setProviderSessionId,
    identity,
    message,
    prompt,
    emitDelta,
    emitTextDelta,
    emitReasoningDelta,
    emitToolStarted,
    emitToolCompleted,
    emitUsageUpdated,
    requestInteraction,
    signal,
    setOperation,
  } = {}) {
    const effectiveSessionId = providerSessionId || `mock-session-${padded(++this.#createdCounter)}`;
    if (setProviderSessionId) setProviderSessionId(effectiveSessionId);
    const inputMessage = message ?? prompt;
    if (!inputMessage || typeof inputMessage !== 'string') {
      throw new AiValidationError('A valid message/prompt is required.');
    }


    const operation = { cancelled: false };
    if (setOperation) setOperation(operation);

    const normalized = inputMessage.toLowerCase();
    const messageId = `assistant-${providerSessionId}-${turnId || '1'}`;
    const emit = emitTextDelta || emitDelta || (() => {});

    if (normalized.includes('tools') || normalized.includes('reasoning')) {
      if (emitReasoningDelta) emitReasoningDelta('Thinking through the problem...', messageId);
      if (emitToolStarted) emitToolStarted({ toolId: 't1', toolName: 'ReadDir', input: { path: '.' } });
      await this.#yield(signal);
      if (emitToolCompleted) emitToolCompleted({ toolId: 't1', output: ['file1.txt', 'file2.txt'], durationMs: 15 });
      if (emitUsageUpdated) emitUsageUpdated({ tokensIn: 50, tokensOut: 25, cost: 0.001 });
    }

    const parts = [
      'Przeanalizowałem Twoją wiadomość i powiązany kontekst. ',
      'Najpierw porządkuję wymagania, ',
      'następnie sprawdzam zależności oraz kryteria akceptacji. ',
      'Mock wysyła tę odpowiedź małymi fragmentami, ',
      'tak jak provider korzystający ze streamu zdarzeń.\n\n',
    ];
    let interactionSummary = '';
    await this.#emitChunks(parts, messageId, emit, signal);

    if (normalized.includes('permission') || normalized.includes('zgod')) {
      const interaction = {
        id: `int-${turnId || '1'}`,
        kind: 'permission',
        toolName: 'Shell',
        input: { command: 'npm --prefix tools/dashboard test' },
        details: 'Run the dashboard test suite.',
      };
      return {
        operation: null,
        isDeferred: true,
        providerSessionId: effectiveSessionId,
        interaction,
      };
    } else if (normalized.includes('question') || normalized.includes('pytan')) {
      const interaction = {
        id: `int-${turnId || '1'}`,
        kind: 'question',
        questions: [
          {
            id: 'q-style',
            question: 'Which implementation style should the mock use?',
            header: 'Style',
            options: [
              { label: 'Focused', description: 'Keep the change narrowly scoped.' },
              { label: 'Detailed', description: 'Include more explanatory output.' },
            ],
            multiSelect: false,
          },
          {
            id: 'q-checks',
            question: 'Which verification should run?',
            header: 'Checks',
            options: [
              { label: 'Tests', description: 'Run automated tests.' },
              { label: 'Build', description: 'Run the production build.' },
            ],
            multiSelect: true,
          },
        ],
      };
      return {
        operation: null,
        isDeferred: true,
        providerSessionId: effectiveSessionId,
        interaction,
      };
    }

    const ending = [
      'Wynik demonstracyjny jest celowo dłuższy, ',
      'żeby było widać narastanie treści w interfejsie. ',
      'W prawdziwej integracji te same neutralne zdarzenia mogą pochodzić ',
      'z dowolnego providera obsługującego streaming.\n\n',
      'Podsumowanie: zachowany został pojedynczy aktywny turn, ',
      'fragmenty należą do jednego stabilnego identyfikatora wiadomości, ',
      'a pełna odpowiedź trafia do historii dopiero po zakończeniu. ',
      'Mock turn jest gotowy.',
    ];
    await this.#emitChunks(ending, messageId, emit, signal);
    return { providerSessionId: effectiveSessionId };
  }

  async respondInteraction({
    turnId,
    providerSessionId,
    interactionId,
    interaction,
    response,
    signal,
    setOperation,
    emitDelta,
    emitTextDelta,
  } = {}) {
    const emit = emitTextDelta || emitDelta || (() => {});
    const messageId = `assistant-${providerSessionId}-${turnId || '1'}`;
    let summary = '';
    if (interaction?.kind === 'permission') {
      summary = response.decision === 'allow' ? 'Permission was allowed. ' : 'Permission was denied. ';
    } else if (interaction?.kind === 'question') {
      summary = `Answers received: ${response.answers?.map(a => Array.isArray(a.value) ? a.value.join(', ') : a.value).join('; ')}. `;
    } else {
      summary = response.confirmed ? 'Confirmed. ' : 'Cancelled. ';
    }

    const ending = [
      summary,
      'Wynik demonstracyjny po wznowieniu. ',
      'Mock turn kontynuuje wykonanie po interakcji i kończy się sukcesem.',
    ];
    await this.#emitChunks(ending, messageId, emit, signal);
    return { providerSessionId };
  }


  async cancelTurn({ operation } = {}) {
    if (operation) operation.cancelled = true;
  }

  #yield(signal) {
    if (signal?.aborted) return Promise.reject(new Error('Mock turn aborted.'));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Mock turn aborted.'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, this.#streamDelayMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async #emitChunks(chunks, messageId, emitDelta, signal) {
    for (const chunk of chunks) {
      emitDelta(chunk, messageId);
      await this.#yield(signal);
    }
  }
}

export function createMockAiAdapter(options) {
  return new MockAiAdapter(options);
}

export { MOCK_CAPABILITIES };
