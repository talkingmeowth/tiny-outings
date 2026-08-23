import assert from 'node:assert/strict';
import test from 'node:test';
import { shareContent } from './shareContent.js';

const shareData = {
  title: 'Tiny Outings',
  text: 'Plan an outing together.',
  url: 'https://tiny-outings-cpjh.onrender.com',
};

test('uses the native share sheet in the installed app', async () => {
  const calls = [];
  const result = await shareContent(shareData, {
    isNative: true,
    nativeShare: { share: async (data) => calls.push(data) },
    navigatorApi: { share: async () => assert.fail('web share should not be used') },
  });

  assert.equal(result, 'native');
  assert.deepEqual(calls, [shareData]);
});

test('uses browser sharing when it is available on the web', async () => {
  const calls = [];
  const result = await shareContent(shareData, {
    isNative: false,
    navigatorApi: { share: async (data) => calls.push(data) },
  });

  assert.equal(result, 'web');
  assert.deepEqual(calls, [shareData]);
});

test('copies a complete fallback share message when browser sharing is unavailable', async () => {
  const copied = [];
  const result = await shareContent(shareData, {
    isNative: false,
    navigatorApi: { clipboard: { writeText: async (value) => copied.push(value) } },
  });

  assert.equal(result, 'clipboard');
  assert.deepEqual(copied, ['Plan an outing together. https://tiny-outings-cpjh.onrender.com']);
});

test('reports unsupported sharing instead of silently failing', async () => {
  await assert.rejects(
    shareContent(shareData, { isNative: false, navigatorApi: {} }),
    /Sharing is not supported/,
  );
});
