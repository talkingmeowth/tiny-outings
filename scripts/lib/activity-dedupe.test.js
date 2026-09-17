import assert from 'node:assert/strict';
import test from 'node:test';
import { findExactDuplicateGroups } from './activity-dedupe.js';

const base = { activity_id: 'one', activity_name: 'Baby Dance', address: '15A Davies Lane, London E11 3DR',
  category: 'Classes & clubs', data_source: 'Happity', google_place_id: 'place-one',
  source_url: 'https://www.happity.co.uk/islington/baby-toddler-classes#baby-dance',
  website: 'https://www.happity.co.uk/schedules/baby-dance', start_time: '10:40:00', end_time: '11:25:00',
  days_of_week: ['Tuesday'], available_days_of_week: ['Tuesday'], availability_type: 'weekly', time_window: 'morning',
  public_listing_status: 'published' };

test('archives only the redundant exact session and keeps its timetable URL', () => {
  const specific = { ...base, activity_id: 'two', source_url: 'https://www.happity.co.uk/schedules/baby-dance-tuesdays-10-40-11-25' };
  const { groups } = findExactDuplicateGroups([base, specific]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keeper.activity_id, 'two');
  assert.deepEqual(groups[0].duplicates.map((item) => item.activity_id), ['one']);
});

test('preserves different venues, weekdays, times, dates, age variants, and availability types', () => {
  for (const change of [
    { address: 'Another street, London E11 3DR' }, { google_place_id: 'other-place' },
    { days_of_week: ['Monday'], available_days_of_week: ['Monday'] }, { start_time: '11:40:00' },
    { activity_date: '2026-09-25' }, { activity_name: 'Toddler Dance' }, { availability_type: 'specific_dates' },
  ]) {
    assert.equal(findExactDuplicateGroups([base, { ...base, ...change, activity_id: 'two' }]).groups.length, 0);
  }
});

test('never archives two manually curated copies or conflicting Google store links', () => {
  const curated = { ...base, admin_cover_image_url: 'https://example.com/a.jpg' };
  assert.equal(findExactDuplicateGroups([curated, { ...curated, activity_id: 'two' }]).groups.length, 0);
  const store = { ...base, data_source: 'Google Places API', source_url: 'https://www.google.com/maps/place/?q=place_id:one',
    google_place_id: 'one', website: 'https://store.example/one' };
  assert.equal(findExactDuplicateGroups([store, { ...store, activity_id: 'two', source_url: 'https://www.google.com/maps/place/?q=place_id:two' }]).groups.length, 0);
});
