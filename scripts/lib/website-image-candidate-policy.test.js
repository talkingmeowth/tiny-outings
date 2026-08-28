import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWebsiteImageCandidates,
  websiteCandidateScore,
} from '../../supabase/functions/_shared/website-image-candidate-policy.js';

test('collects all unique full-size website images and preserves page context', () => {
  const html = `
    <meta property="og:image" content="/images/hero-1600.jpg">
    <img src="/images/tiny.jpg" srcset="/images/room-640.jpg 640w, /images/room-1600.jpg 1600w" alt="Activity room and seating" height="900">
    <img data-src="/images/exterior.jpg" width="1400" height="900" alt="Venue exterior">
    <img src="/images/exterior.jpg" alt="duplicate">
  `;
  const candidates = extractWebsiteImageCandidates(html, 'https://venue.example/visit', 'organiser');
  assert.deepEqual(candidates.map((candidate) => candidate.original).sort(), [
    'https://venue.example/images/exterior.jpg',
    'https://venue.example/images/hero-1600.jpg',
    'https://venue.example/images/room-1600.jpg',
  ]);
  assert.equal(candidates.find((candidate) => candidate.original.endsWith('room-1600.jpg')).original_width, 1600);
  assert.ok(candidates.every((candidate) => candidate.link === 'https://venue.example/visit'));
  assert.ok(candidates.every((candidate) => candidate.source_kind === 'organiser'));
});

test('removes logos, icons, tracking pixels, and known low-resolution candidates before vision', () => {
  const html = `
    <img src="/logo.png" width="1200" height="500" alt="Venue logo">
    <img src="/icons/search.png" width="512" height="512" alt="Search">
    <img src="/tracking/pixel.gif" width="1" height="1">
    <img src="/gallery/interior.jpg" width="1400" height="900" alt="Cafe interior and seating">
  `;
  const candidates = extractWebsiteImageCandidates(html, 'https://cafe.example/');
  assert.deepEqual(candidates.map((candidate) => candidate.original), ['https://cafe.example/gallery/interior.jpg']);
});

test('quality scoring strongly penalises known tiny images', () => {
  const full = websiteCandidateScore('https://venue.example/gallery/interior.jpg', 'venue interior', 1600, 1000);
  const tiny = websiteCandidateScore('https://venue.example/gallery/interior.jpg', 'venue interior', 180, 120);
  assert.ok(full > tiny + 100);
});

test('does not mistake responsive layout dimensions for the original image size', () => {
  const [candidate] = extractWebsiteImageCandidates(
    '<img src="/gallery/play-frame.avif" width="240" height="200" alt="Indoor soft play frame">',
    'https://venue.example/',
  );
  assert.equal(candidate.original_width, null);
  assert.equal(candidate.original_height, null);
  assert.ok(candidate.metadata_score > 0);
});
