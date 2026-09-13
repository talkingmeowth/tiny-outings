import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';

import {
  ACTIVITY_PAGE_SIZE,
  isTransientActivityLoadError,
  loadActivityPageWithRetries,
  loadActivityPages,
  loadCachedActivityDirectory,
} from './activityLoader.js';

test('keeps activity pages small enough for the production PostgREST query', () => {
  assert.ok(ACTIVITY_PAGE_SIZE <= 250);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('loads remaining pages concurrently, respects the limit, and preserves database ordering', async () => {
  const pending = new Map();
  let active = 0;
  let peak = 0;
  const started = [];
  const result = loadActivityPages(async (from, to, includeCount) => {
    started.push(from);
    assert.equal(to, from + 1);
    if (from === 0) {
      assert.equal(includeCount, true);
      return { data: [0, 1], count: 9 };
    }
    assert.equal(includeCount, false);
    active += 1;
    peak = Math.max(peak, active);
    const page = deferred();
    pending.set(from, page);
    const data = await page.promise;
    active -= 1;
    return { data };
  }, { pageSize: 2, concurrency: 3 });
  await new Promise(setImmediate);
  assert.deepEqual(started, [0, 2, 4, 6]);
  pending.get(6).resolve([6, 7]);
  await new Promise(setImmediate);
  pending.get(8).resolve([8]);
  pending.get(4).resolve([4, 5]);
  pending.get(2).resolve([2, 3]);
  assert.deepEqual(await result, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(peak, 3);
});

test('falls back to bounded pagination when a count is unavailable', async () => {
  const rows = [0, 1, 2, 3, 4];
  const result = await loadActivityPages(async (from, to) => ({ data: rows.slice(from, to + 1) }),
    { pageSize: 2, concurrency: 2 });
  assert.deepEqual(result, rows);
});

test('does not publish an incomplete directory after a later page fails', async () => {
  await assert.rejects(loadActivityPages(async (from) => from === 0
    ? { data: [0, 1], count: 4 }
    : { error: new Error('permission denied'), status: 403 }, { pageSize: 2 }), /permission denied/);
});

test('cancelling a directory load stops further page requests', async () => {
  const controller = new AbortController();
  const pending = deferred();
  let calls = 0;
  const result = loadActivityPages(async () => { calls += 1; return pending.promise; }, { signal: controller.signal });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  controller.abort();
  pending.resolve({ data: [0, 1], count: 100 });
  await rejected;
  assert.equal(calls, 1);
});

test('a cache hit renders before network refresh, then the fresh directory replaces it', async () => {
  const network = deferred();
  const events = [];
  const result = loadCachedActivityDirectory({
    readCache: async () => ['cached'],
    loadFresh: () => network.promise,
    onData: (data, fresh) => events.push({ data, fresh }),
  });
  await new Promise(setImmediate);
  assert.deepEqual(events, [{ data: ['cached'], fresh: false }]);
  network.resolve([]);
  await result;
  assert.deepEqual(events[1], { data: [], fresh: true });
});

test('a slow cache never overwrites newer network data, even when the directory is empty', async () => {
  const disk = deferred();
  const events = [];
  await loadCachedActivityDirectory({
    readCache: () => disk.promise, loadFresh: async () => [],
    onData: (data, fresh) => events.push({ data, fresh }),
  });
  disk.resolve(['stale activity']);
  await new Promise(setImmediate);
  assert.deepEqual(events, [{ data: [], fresh: true }]);
});

test('network failure keeps the cached directory available', async () => {
  const events = [];
  await assert.rejects(loadCachedActivityDirectory({
    readCache: async () => ['cached'], loadFresh: async () => { throw new Error('offline'); },
    onData: (data, fresh) => events.push({ data, fresh }),
  }), /offline/);
  assert.deepEqual(events, [{ data: ['cached'], fresh: false }]);
});

test('cache failure does not block the network and cancelled loads never update the screen', async () => {
  const events = [];
  await loadCachedActivityDirectory({
    readCache: async () => { throw new Error('storage blocked'); }, loadFresh: async () => ['fresh'],
    onData: (data) => events.push(data),
  });
  assert.deepEqual(events, [['fresh']]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadCachedActivityDirectory({
    readCache: async () => ['stale'], loadFresh: async () => ['cancelled'], signal: controller.signal,
    onData: (data) => events.push(data),
  }), { name: 'AbortError' });
  assert.deepEqual(events, [['fresh']]);
});

test('retries a transient database timeout and returns the successful page', async () => {
  let calls = 0;
  const delays = [];
  const response = await loadActivityPageWithRetries(
    async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: { message: 'canceling statement due to statement timeout' }, status: 500 }
        : { data: [{ activity_id: 'activity-1' }], error: null, status: 200 };
    },
    { wait: async (delay) => delays.push(delay) },
  );

  assert.equal(calls, 2);
  assert.deepEqual(delays, [400]);
  assert.equal(response.error, null);
  assert.equal(response.data[0].activity_id, 'activity-1');
});

test('does not retry a permanent activity-query error', async () => {
  let calls = 0;
  const response = await loadActivityPageWithRetries(
    async () => {
      calls += 1;
      return { data: null, error: { message: 'column does not exist' }, status: 400 };
    },
    { wait: async () => {} },
  );

  assert.equal(calls, 1);
  assert.equal(response.status, 400);
  assert.equal(isTransientActivityLoadError(response.error, response.status), false);
});
