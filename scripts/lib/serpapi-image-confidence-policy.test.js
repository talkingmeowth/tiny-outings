import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSerpApiCandidate,
  chooseBestSerpApiCandidate,
  labelsForSerpApiImageAudit,
} from './serpapi-image-confidence-policy.js';

function activity(category, name = 'Bright Bean Cafe') {
  return {
    activity_name: name,
    category,
    website: 'https://brightbean.example/visit',
    organiser_website: null,
  };
}

function candidate(title = 'Bright Bean Cafe London') {
  return {
    original: 'https://brightbean.example/images/venue.jpg',
    link: 'https://brightbean.example/visit',
    title,
    source: 'Bright Bean Cafe',
    position: 1,
    original_width: 1200,
    original_height: 800,
  };
}

function visual(labels, scores) {
  return labels.map((label, index) => ({ label, score: scores[index] || 0 }));
}

test('cafes choose a high-confidence interior before a stronger exterior candidate', () => {
  const item = activity('Cafes & food');
  const labels = labelsForSerpApiImageAudit(item);
  const candidates = [candidate('Bright Bean Cafe interior'), candidate('Bright Bean Cafe exterior')];
  const chosen = chooseBestSerpApiCandidate(item, candidates, [
    visual(labels, [0.62, 0.12, 0.04, 0.01, 0.05, 0.01]),
    visual(labels, [0.22, 0.89, 0.03, 0.01, 0.02, 0.01]),
  ]);
  assert.equal(chosen.selection.index, 0);
  assert.match(chosen.selection.assessment.reason, /interior/i);
});

test('logos are rejected even when the candidate comes from the official site', () => {
  const item = activity('Play cafes');
  const labels = labelsForSerpApiImageAudit(item);
  const assessment = assessSerpApiCandidate(item, candidate('Bright Bean Cafe logo'),
    visual(labels, [0.05, 0.03, 0.01, 0.92, 0.01, 0.01]));
  assert.equal(assessment.outcome, 'remove');
});

test('bookshops prefer an exterior over an interior image', () => {
  const item = activity('Bookshops', 'Little Pages Bookshop');
  item.website = 'https://littlepages.example';
  const labels = labelsForSerpApiImageAudit(item);
  const candidates = [
    { ...candidate('Little Pages Bookshop interior'), original: 'https://littlepages.example/inside.jpg', link: 'https://littlepages.example' },
    { ...candidate('Little Pages Bookshop exterior'), original: 'https://littlepages.example/front.jpg', link: 'https://littlepages.example' },
  ];
  const chosen = chooseBestSerpApiCandidate(item, candidates, [
    visual(labels, [0.18, 0.74, 0.01, 0.02, 0.01]),
    visual(labels, [0.68, 0.25, 0.01, 0.02, 0.01]),
  ]);
  assert.equal(chosen.selection.index, 1);
  assert.match(chosen.selection.assessment.reason, /exterior/i);
});

test('a one-word listing without an official host is not accepted from a vague image result', () => {
  const item = activity('Museums & culture', 'Momentum');
  item.website = null;
  const labels = labelsForSerpApiImageAudit(item);
  const assessment = assessSerpApiCandidate(item, {
    original: 'https://unrelated.example/momentum.jpg',
    title: 'Momentum London',
    source: 'Unrelated directory',
    position: 1,
  }, visual(labels, [0.82, 0.07, 0.01, 0.02, 0.01]));
  assert.equal(assessment.outcome, 'remove');
  assert.match(assessment.reason, /official-source/i);
});

test('the local selector rejects Wikimedia outside parks, museums, and family activities', () => {
  const item = activity('Cafes & food');
  const labels = labelsForSerpApiImageAudit(item);
  const assessment = assessSerpApiCandidate(item, {
    ...candidate('Bright Bean Cafe interior'),
    original: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Bright_Bean.jpg',
    link: 'https://commons.wikimedia.org/wiki/File:Bright_Bean.jpg',
    source: 'Wikimedia Commons',
  }, visual(labels, [0.92, 0.03, 0.01, 0.01, 0.01, 0.01]));

  assert.equal(assessment.outcome, 'remove');
  assert.match(assessment.reason, /Wikimedia images are not allowed/i);
});
