import assert from 'node:assert/strict';
import test from 'node:test';
import { loadActivityReviews, REVIEW_COLUMNS, reviewAuthor, reviewSummary, sortReviews } from './activityReviewData.js';

test('community rating uses only real valid reviews, never imported Google ratings', () => {
  assert.deepEqual(reviewSummary([]), { count: 0, average: null });
  assert.deepEqual(reviewSummary([{ rating: 5 }, { rating: 4 }, { rating: null }, { rating: 8 }, { rating: 2.5 }]), { count: 2, average: 4.5 });
});
test('review author uses public names with a safe anonymous fallback', () => {
  assert.equal(reviewAuthor({ author: { display_name: 'Amira', email: 'private@example.test' } }), 'Amira');
  assert.equal(reviewAuthor({ author: [{ user_name: 'Ben' }] }), 'Ben');
  assert.equal(reviewAuthor({ author: null }), 'Parent or carer');
  assert.doesNotMatch(REVIEW_COLUMNS, /email|avatar|followers/);
});
test('review sorting does not mutate source data and supports rating orders', () => {
  const rows = [{ review_id: 'a', rating: 5, created_at: '2026-09-01' }, { review_id: 'b', rating: 4, created_at: '2026-09-02' }];
  assert.equal(sortReviews(rows, 'recent')[0].review_id, 'b');
  assert.equal(sortReviews(rows, 'highest')[0].review_id, 'a');
  assert.equal(sortReviews(rows, 'lowest')[0].review_id, 'b');
  assert.equal(rows[0].review_id, 'a');
});
test('review loader reads every page for an accurate count and propagates failures', async () => {
  const ranges = [];
  const signal = new AbortController().signal;
  const query = {
    select(columns) { assert.equal(columns, REVIEW_COLUMNS); return this; },
    eq(column, id) { assert.equal(column, 'activity_id'); assert.equal(id, 'activity'); return this; },
    order() { return this; }, range(start, end) { ranges.push([start, end]); return this; },
    abortSignal(input) { assert.equal(input, signal); return Promise.resolve({ data: ranges.length === 1 ? Array(200).fill({ rating: 5 }) : [{ rating: 4 }] }); },
  };
  const rows = await loadActivityReviews({ from: () => query }, 'activity', signal);
  assert.equal(rows.length, 201);
  assert.deepEqual(ranges, [[0, 199], [200, 399]]);
  query.abortSignal = () => Promise.resolve({ error: new Error('network') });
  await assert.rejects(loadActivityReviews({ from: () => query }, 'activity', signal), /network/);
  await assert.rejects(loadActivityReviews(null, 'activity', signal), /unavailable/);
});
