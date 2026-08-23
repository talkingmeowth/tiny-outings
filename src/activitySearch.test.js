import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityNameMatchesSearch,
  sortActivityNameSearchResults,
} from './activitySearch.js';

test('directory search matches terms in the activity name, not the description or category', () => {
  assert.equal(activityNameMatchesSearch({ activity_name: 'Baby Sensory Mixed Ages' }, 'baby sensory'), true);
  assert.equal(activityNameMatchesSearch({ activity_name: 'Story time', category: 'Baby sensory' }, 'baby sensory'), false);
  assert.equal(activityNameMatchesSearch({ activity_name: 'Story time', description: 'A baby sensory session' }, 'baby sensory'), false);
});

test('directory search accepts a meaningful name prefix but rejects weak two-letter matches', () => {
  assert.equal(activityNameMatchesSearch({ activity_name: 'Penguin Play Cafe' }, 'peng play'), true);
  assert.equal(activityNameMatchesSearch({ activity_name: 'Penguin Play Cafe' }, 'pe play'), false);
});

test('directory search finds a listing when the query is its full activity name', () => {
  assert.equal(activityNameMatchesSearch({ activity_name: 'Martil Cafe' }, 'Martil'), true);
  assert.equal(activityNameMatchesSearch({ activity_name: 'Martil Cafe' }, 'Martil Cafe'), true);
});

test('directory search ranks exact activity names before broader name matches', () => {
  const results = sortActivityNameSearchResults([
    { activity_name: 'Baby sensory mixed ages' },
    { activity_name: 'Baby sensory' },
    { activity_name: 'Baby sensory at the library' },
  ], 'baby sensory');

  assert.deepEqual(results.map((activity) => activity.activity_name), [
    'Baby sensory',
    'Baby sensory at the library',
    'Baby sensory mixed ages',
  ]);
});
