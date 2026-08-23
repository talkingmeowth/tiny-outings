import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPipelineOptions,
  generatedOutputIsFresh,
  hasActivityDatabaseChanges,
} from './import-pipeline-policy.js';

test('only permits apply-only mode when a database apply was explicitly requested', () => {
  assert.throws(() => assertPipelineOptions({ applyChanges: false, applyOnly: true }), /must be used together with --apply/);
  assert.doesNotThrow(() => assertPipelineOptions({ applyChanges: true, applyOnly: true }));
});

test('recognises activity SQL while ignoring audit-only output', () => {
  assert.equal(hasActivityDatabaseChanges('update public.activities set archive = true;'), true);
  assert.equal(hasActivityDatabaseChanges('insert into public.activities (activity_name) values (\'Test\');'), true);
  assert.equal(hasActivityDatabaseChanges('{"audit":"no database writes"}'), false);
});

test('requires each importer to refresh its generated output', () => {
  assert.equal(generatedOutputIsFresh(undefined, 100), true);
  assert.equal(generatedOutputIsFresh(100, 101), true);
  assert.equal(generatedOutputIsFresh(100, 100), false);
  assert.equal(generatedOutputIsFresh(100, undefined), false);
});
