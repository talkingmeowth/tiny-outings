import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ageForFamilyHubSession,
  categoryForFamilyHubSession,
  isFamilyActivitySession,
  parseTimeRange,
  parseTimeRanges,
  validateFamilyHubSession,
  weekdayFromHeading,
} from './family-hub-timetable-policy.js';

test('parses council timetable time ranges and inherited meridiems', () => {
  assert.deepEqual(parseTimeRange('Mondays, 10am to 11.30am'), { start_time: '10:00', end_time: '11:30' });
  assert.deepEqual(parseTimeRange('1.15 to 2.30pm'), { start_time: '13:15', end_time: '14:30' });
  assert.deepEqual(parseTimeRange('10am to midday'), { start_time: '10:00', end_time: '12:00' });
  assert.equal(parseTimeRange('Drop in throughout the day'), null);
  assert.equal(parseTimeRange('Stay and play for children aged 0-5'), null);
  assert.equal(parseTimeRange('Toddler group for children 1 to 2 years'), null);
  assert.deepEqual(parseTimeRange('Session for ages 0-5, 12 to 2pm'), { start_time: '12:00', end_time: '14:00' });
  assert.deepEqual(parseTimeRanges('Session 1: 9.30 to 10.30am. Session 2: 11am to 12pm'), [
    { start_time: '09:30', end_time: '10:30' },
    { start_time: '11:00', end_time: '12:00' },
  ]);
});

test('keeps child and parent activities but excludes generic support appointments', () => {
  assert.equal(isFamilyActivitySession('Stay and Play', '0 to 5 years'), true);
  assert.equal(isFamilyActivitySession('Baby Massage', 'six-week course'), true);
  assert.equal(isFamilyActivitySession('Health visitor assessments', 'appointment only'), false);
  assert.equal(isFamilyActivitySession('Family Navigator surgery', 'advice and support'), false);
  assert.equal(isFamilyActivitySession('Parent - Infant Psychotherapy', 'appointment only'), false);
});

test('derives useful categories and ages', () => {
  assert.equal(categoryForFamilyHubSession('Little Explorers stay and play'), 'Stay & play');
  assert.equal(categoryForFamilyHubSession('Baby massage'), 'Baby massage');
  assert.equal(ageForFamilyHubSession('Baby Explorers', 'Age: 0 to 12 months Time: 10am'), '0 to 12 months');
  assert.equal(weekdayFromHeading('Thursdays'), 'Thursday');
});

test('rejects incomplete timetable rows before SQL generation', () => {
  assert.deepEqual(validateFamilyHubSession({
    activity_name: 'Stay and Play',
    hub_postcode: 'N1 2SX',
    day: 'Monday',
    start_time: '10:00',
    end_time: '11:30',
    source_page_url: 'https://example.gov.uk/timetable',
  }), []);
  assert.ok(validateFamilyHubSession({ activity_name: 'Generic hub' }).length >= 4);
});
