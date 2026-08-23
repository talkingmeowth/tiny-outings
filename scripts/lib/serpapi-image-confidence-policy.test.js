import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessSerpApiImageConfidence,
  labelsForSerpApiImageAudit,
  sourceConfidence,
} from './serpapi-image-confidence-policy.js';

function scores(labels, values) {
  return labels.map((label) => ({ label, score: values[label] || 0 }));
}

test('does not accept an official home-page image with a single weak name match', () => {
  const activity = {
    activity_name: 'Mome London',
    category: 'Cafes & food',
    website: 'https://momelondon.com/',
    image_source_url: 'https://momelondon.com/',
  };
  assert.equal(sourceConfidence(activity).highConfidence, false);
});

test('does not accept a third-party image page despite matching activity words', () => {
  const activity = {
    activity_name: 'Stationers Park Cafe London',
    category: 'Cafes & food',
    website: 'https://stationersparkcafe.example/',
    image_source_url: 'https://unrelated-images.example/stationers-park-cafe-london.jpg',
  };
  assert.equal(sourceConfidence(activity).highConfidence, false);
});

test('removes a cafe image that visually shows wildlife rather than the venue', () => {
  const activity = {
    activity_name: 'Mome London Cafe',
    category: 'Cafes & food',
    website: 'https://momelondon.com/',
    image_source_url: 'https://momelondon.com/gallery/mome-london-cafe.jpg',
  };
  const labels = labelsForSerpApiImageAudit(activity);
  const assessment = assessSerpApiImageConfidence(activity, scores(labels, {
    [labels[0]]: 0.001,
    [labels[1]]: 0.001,
    [labels[3]]: 0.88,
    [labels[4]]: 0.11,
  }));
  assert.equal(assessment.outcome, 'remove');
  assert.match(assessment.reason, /pixels/i);
});

test('retains a clearly matching official cafe image', () => {
  const activity = {
    activity_name: 'Sunbeam Play Cafe London',
    category: 'Play cafes',
    website: 'https://sunbeamplaycafe.co.uk/',
    image_source_url: 'https://sunbeamplaycafe.co.uk/gallery/sunbeam-play-cafe-interior.jpg',
  };
  const labels = labelsForSerpApiImageAudit(activity);
  const assessment = assessSerpApiImageConfidence(activity, scores(labels, {
    [labels[0]]: 0.63,
    [labels[1]]: 0.27,
    [labels[4]]: 0.05,
  }));
  assert.equal(assessment.outcome, 'retain');
});
