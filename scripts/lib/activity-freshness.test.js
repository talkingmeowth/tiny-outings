import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseHappityReaderPage,
  parseWalthamForestEventPage,
  scheduleDiffers,
  scheduleFromEvent,
} from './activity-freshness.js';

const now = new Date('2026-09-13T10:00:00Z');

test('reads a current Happity weekday and time from the schedule title', () => {
  assert.deepEqual(parseHappityReaderPage(`Title: Puddle Ducks, Mon 10:00-10:30 - Baby & Toddler Classes London\n\nMarkdown Content:`), {
    state: 'active', kind: 'weekly', name: 'Puddle Ducks', start: '10:00', end: '10:30', days: ['Monday'],
    title: 'Puddle Ducks, Mon 10:00-10:30 - Baby & Toddler Classes London',
    reason: 'Current weekday and time from the live Happity schedule title',
  });
});

test('treats a Happity schedule URL resolving to the directory as stale', () => {
  const result = parseHappityReaderPage('Title: Find Baby Classes & Toddler Groups | Happity');
  assert.equal(result.state, 'stale');
  assert.match(result.reason, /generic directory/);
});

test('reads a future one-off Event date in London time', () => {
  const result = scheduleFromEvent({
    '@type': 'Event', name: 'Family show',
    startDate: '2026-09-20T10:00:00+01:00', endDate: '2026-09-20T11:15:00+01:00',
    eventStatus: 'https://schema.org/EventScheduled',
  }, { now });
  assert.deepEqual(result, {
    state: 'active', kind: 'specific-date', name: 'Family show', date: '2026-09-20',
    start: '10:00', end: '11:15', days: ['Sunday'], reason: 'Current date and time from Event structured data',
  });
});

test('archives only authoritative cancelled or elapsed events', () => {
  assert.equal(scheduleFromEvent({ '@type': 'Event', eventStatus: 'https://schema.org/EventCancelled' }, { now }).state, 'stale');
  assert.equal(scheduleFromEvent({ '@type': 'Event', startDate: '2026-09-01T10:00:00+01:00', endDate: '2026-09-01T11:00:00+01:00' }, { now }).state, 'stale');
  assert.equal(scheduleFromEvent({ '@type': 'Event', startDate: '2024-01-01', endDate: '2027-01-01' }, { now, pageHtml: '"isSeries":true' }).state, 'active');
});

test('keeps a currently open multi-month attraction as a date range', () => {
  const result = scheduleFromEvent({
    '@type': 'Event', name: 'Family attraction',
    startDate: '2026-02-18T12:00:00Z', endDate: '2026-12-31T18:00:00Z',
  }, { now });
  assert.equal(result.state, 'active');
  assert.equal(result.kind, 'date-range');
  assert.equal(result.date, undefined);
});

test('does not replace a recurring Eventbrite series with its historical start', () => {
  const result = scheduleFromEvent({
    '@type': 'Event', name: 'Stories and rhyme',
    startDate: '2023-09-15T19:00:00+01:00', endDate: '2027-03-12T11:30:00Z',
  }, { now, pageHtml: '"isSeries":true,"nextAvailableSession":"2026-09-09T11:00:00+01"' });
  assert.equal(result.kind, 'series');
  assert.equal(result.date, undefined);
});

test('reads authoritative council event dates and times', () => {
  const html = '<div class="details-block__label">Event date:</div><div class="details-block__value details-block__value--date">Wednesday 16 September 2026 - 1pm to 2pm</div>';
  assert.deepEqual(parseWalthamForestEventPage(html, { now }), {
    state: 'active', kind: 'specific-date', date: '2026-09-16', start: '13:00', end: '14:00', days: ['Wednesday'],
    reason: 'Current date and time from the council event page',
  });
});

test('detects date, time, and weekday changes', () => {
  const activity = { activity_date: '2026-09-20', start_time: '10:00:00', end_time: '11:00:00', days_of_week: ['Sunday'] };
  assert.equal(scheduleDiffers(activity, { kind: 'specific-date', date: '2026-09-20', start: '10:00', end: '11:00', days: ['Sunday'] }), false);
  assert.equal(scheduleDiffers(activity, { kind: 'specific-date', date: '2026-09-21', start: '10:00', end: '11:00', days: ['Monday'] }), true);
});
