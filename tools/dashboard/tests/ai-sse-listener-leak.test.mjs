import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createAgentProviderRegistry } from '../server/ai/providers/registry.mjs';
import { createAgentSessionService } from '../server/ai/sessions/service.mjs';
import { createAgentTurnRuntime } from '../server/ai/sessions/turns/runtime.mjs';
import { createTranscriptCacheService } from '../server/ai/sessions/transcript-cache.mjs';
import { listen } from '../server/index.mjs';
import { buildAiTestApp } from './helpers/ai-test-app.mjs';

// Reproduces the MaxListenersExceededWarning regression: a client reconnecting to
// /api/agent-sessions/:provider/:providerSessionId/events with a stale `after` cursor
// makes TurnEventStream.subscribeToSession() replay every buffered session event
// synchronously (turn-event-stream.mjs). The route dispatched each replayed event as an
// independent, un-awaited reply.sse.send() call. @fastify/sse's writeToStream() registers
// a fresh once('drain')/once('error') pair on the raw ServerResponse every time write()
// reports backpressure — so a burst of concurrent sends piled up one listener pair per
// event before any of them had a chance to resolve, exceeding Node's default MaxListeners
// almost immediately on any reconnect with more than ~10 buffered events.
const capabilities = Object.freeze({
  interactivePermissions: false,
  interactiveQuestions: false,
  interactiveConfirmations: false,
  resumeSession: true,
  cancelTurn: true,
  toolCalls: false,
  reasoning: false,
  usage: false,
});

function createChattyProvider(deltaCount) {
  return {
    descriptor: { id: 'chatty', label: 'Chatty', capabilities },
    async startTurn({ emitCommentaryDelta, emitFinalAnswerDelta }) {
      for (let i = 0; i < deltaCount; i += 1) {
        emitCommentaryDelta(`chunk-${i} `, `commentary-${i}`);
      }
      emitFinalAnswerDelta('done');
    },
    async cancelTurn() {},
  };
}

async function waitFor(read, predicate, message = 'condition') {
  for (let i = 0; i < 200; i += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for: ${message}`);
}

test('SSE replay burst never lets ServerResponse drain/error listeners exceed a small bound (regression for MaxListenersExceededWarning)', async () => {
  const DELTA_COUNT = 60; // comfortably more than Node's default maxListeners (10)
  const provider = createChattyProvider(DELTA_COUNT);
  const registry = createAgentProviderRegistry([provider]);
  const transcriptCache = createTranscriptCacheService({
    baseDir: join(tmpdir(), `nevo-ai-sse-leak-test-${randomUUID()}`),
  });
  const turnRuntime = createAgentTurnRuntime({ registry, transcriptCache });
  const service = createAgentSessionService({ registry, turnRuntime, transcriptCache });

  const app = await buildAiTestApp({ service });

  // Peak-listener tracking, scoped to exactly the transient once('drain')/once('error')
  // pairs writeToStream() registers per write-with-backpressure — NOT the one permanent
  // 'error' listener SSEContext's constructor adds via .on() for the whole connection's
  // lifetime (that one is correct and expected to persist). Tracked by intercepting
  // once()/off() rather than reading the aggregate listenerCount(), which would conflate
  // the permanent connection-level handler with the transient per-write ones.
  let capturedRawRes = null;
  let pendingOnceDrain = 0;
  let pendingOnceError = 0;
  let maxPendingOnceDrain = 0;
  let maxPendingOnceError = 0;
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.includes('/events')) return;
    const rawRes = reply.raw;
    capturedRawRes = rawRes;

    // Force every write to report backpressure so writeToStream()'s once('drain')/
    // once('error') registration path is deterministically exercised on every send,
    // regardless of how small the real payload is or how fast loopback drains it.
    const originalWrite = rawRes.write.bind(rawRes);
    rawRes.write = (...args) => {
      originalWrite(...args);
      return false;
    };

    const wrapperByListener = new Map();
    const originalOnce = rawRes.once.bind(rawRes);
    const originalOff = rawRes.off.bind(rawRes);

    rawRes.once = (event, listener) => {
      if (event !== 'drain' && event !== 'error') return originalOnce(event, listener);
      const wrapped = (...args) => {
        wrapperByListener.delete(listener);
        if (event === 'drain') pendingOnceDrain -= 1;
        else pendingOnceError -= 1;
        return listener(...args);
      };
      wrapperByListener.set(listener, wrapped);
      if (event === 'drain') {
        pendingOnceDrain += 1;
        maxPendingOnceDrain = Math.max(maxPendingOnceDrain, pendingOnceDrain);
      } else {
        pendingOnceError += 1;
        maxPendingOnceError = Math.max(maxPendingOnceError, pendingOnceError);
      }
      return originalOnce(event, wrapped);
    };

    rawRes.off = (event, listener) => {
      const wrapped = wrapperByListener.get(listener);
      if (wrapped) {
        wrapperByListener.delete(listener);
        if (event === 'drain') pendingOnceDrain -= 1;
        else pendingOnceError -= 1;
        return originalOff(event, wrapped);
      }
      return originalOff(event, listener);
    };
  });

  const baseUrl = await listen(app, { port: 0 });

  try {
    const providerSessionId = 'chatty-session-1';
    const { turnId } = await service.startTurn('chatty', providerSessionId, { message: 'go' });
    await waitFor(
      () => service.getTurn(turnId),
      (snap) => snap.status === 'completed',
      'turn completion',
    );

    // Reconnect with after=0: subscribeToSession() replays every buffered event for
    // this session synchronously in one tight loop — the exact reconnect-with-backlog
    // scenario from the production incident (after=41 -> after=61 -> after=224).
    const controller = new AbortController();
    const response = await fetch(
      `${baseUrl}/api/agent-sessions/chatty/${encodeURIComponent(providerSessionId)}/events?after=0`,
      { headers: { accept: 'text/event-stream' }, signal: controller.signal },
    );
    assert.equal(response.status, 200);

    // Give the serialized send queue a chance to actually attempt writes (each write
    // is forced into the backpressure branch above).
    await new Promise((resolve) => setTimeout(resolve, 50));

    controller.abort();
    await response.body?.cancel?.().catch(() => {});

    assert.ok(capturedRawRes, 'the SSE route must have been hit');
    assert.ok(
      maxPendingOnceDrain <= 1,
      `expected at most 1 concurrently-pending 'drain' listener (serialized sends), saw ${maxPendingOnceDrain}`,
    );
    assert.ok(
      maxPendingOnceError <= 1,
      `expected at most 1 concurrently-pending 'error' listener (serialized sends), saw ${maxPendingOnceError}`,
    );
  } finally {
    await service.shutdown();
    await app.close();
  }
});
