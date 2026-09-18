import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadSubmittedImage, imageDimensions, publicImageUrl } from './remoteImage.js';

function png(width = 600, height = 500, size = 6000) {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test('submitted URLs must be public HTTPS photos', () => {
  assert.equal(publicImageUrl('https://photos.example.org/class.jpg#fragment').href,
    'https://photos.example.org/class.jpg');
  for (const url of [
    'http://photos.example.org/class.jpg',
    'https://127.0.0.1/class.jpg',
    'https://127.1/class.jpg',
    'https://127.0.0.1.nip.io/class.jpg',
    'https://localhost/class.jpg',
    'https://admin:secret@photos.example.org/class.jpg',
    'https://photos.example.org/logo.png',
    'file:///tmp/photo.jpg',
  ]) assert.throws(() => publicImageUrl(url), Error, url);
});

test('downloads a plausible image and records dimensions', async () => {
  const bytes = png();
  assert.deepEqual(imageDimensions(bytes, 'image/png'), { width: 600, height: 500 });
  const image = await downloadSubmittedImage('https://photos.example.org/class.png', async () =>
    new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } }));
  assert.equal(image.mime, 'image/png');
  assert.equal(image.extension, 'png');
  assert.equal(image.width, 600);
  assert.equal(image.height, 500);
  assert.equal(image.bytes.length, 6000);
});

test('rejects tiny, non-image and oversized responses', async () => {
  await assert.rejects(downloadSubmittedImage('https://photos.example.org/tiny.png', async () =>
    new Response(png(200, 500), { headers: { 'content-type': 'image/png' } })), /300px/);
  await assert.rejects(downloadSubmittedImage('https://photos.example.org/page', async () =>
    new Response('<html>not a photo</html>', { headers: { 'content-type': 'text/html' } })), /supported photo/);
  await assert.rejects(downloadSubmittedImage('https://photos.example.org/large.png', async () =>
    new Response(png(), { headers: { 'content-type': 'image/png', 'content-length': String(9 * 1024 * 1024) } })), /8 MB/);
});

test('validates redirect destinations too', async () => {
  await assert.rejects(downloadSubmittedImage('https://photos.example.org/class.jpg', async () =>
    new Response(null, { status: 302, headers: { location: 'https://localhost/private.png' } })), /public HTTPS/);
});
