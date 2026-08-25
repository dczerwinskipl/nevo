import test from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore, runAsync } from '../lib/github.mjs';

test('Semaphore — concurrency limiting and cancellation', async (t) => {
  await t.test('acquires up to max concurrency and releases sequentially', async () => {
    const sem = new Semaphore(2);
    const release1 = await sem.acquire();
    const release2 = await sem.acquire();
    assert.equal(sem.current, 2);

    let acquired3 = false;
    const promise3 = sem.acquire().then(rel => {
      acquired3 = true;
      return rel;
    });

    assert.equal(acquired3, false);
    release1();
    const release3 = await promise3;
    assert.equal(acquired3, true);
    release2();
    release3();
    assert.equal(sem.current, 0);
  });

  await t.test('rejects immediately when acquiring with an already-aborted signal', async () => {
    const sem = new Semaphore(1);
    const controller = new AbortController();
    controller.abort(new Error('Pre-aborted'));

    await assert.rejects(
      async () => {
        await sem.acquire(controller.signal);
      },
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      },
    );
  });

  await t.test('removes waiter and rejects if aborted while waiting in queue', async () => {
    const sem = new Semaphore(1);
    const release1 = await sem.acquire();

    const controller = new AbortController();
    const waitPromise = sem.acquire(controller.signal);

    assert.equal(sem.queue.length, 1);
    controller.abort(new Error('Cancelled while queued'));

    await assert.rejects(
      waitPromise,
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      },
    );

    assert.equal(sem.queue.length, 0);
    release1();
    assert.equal(sem.current, 0);
  });
});

test('runAsync — propagates AbortSignal through execution boundary', async (t) => {
  await t.test('rejects with AbortError when signal is aborted before running', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Aborted'));

    await assert.rejects(
      async () => {
        await runAsync(process.cwd(), ['--version'], { signal: controller.signal });
      },
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      },
    );
  });
});
