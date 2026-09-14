import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const activityLinkAutofill = readFileSync(new URL('../supabase/functions/activity-link-autofill/index.ts', import.meta.url), 'utf8');

test('age filtering starts at Any age instead of restoring a narrow saved age', () => {
  assert.match(app, /ageRange: 'all'/);
  const initializer = app.slice(app.indexOf('const [filters, setFilters]'), app.indexOf('const [calendarMonth'));
  assert.match(initializer, /ageRange: defaults.ageRange/);
  assert.doesNotMatch(initializer, /stored\.ageRange/);
});

test('duplicate activity photo is constrained inside its preview card', () => {
  const rule = styles.match(/\.duplicate-activity-photo\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /position:\s*relative/);
  assert.match(rule, /overflow:\s*hidden/);
});

test('website autofill fallback cannot mislabel a non-Google URL as Google Maps', () => {
  assert.match(activityLinkAutofill, /function basicWebsiteListing/);
  assert.match(activityLinkAutofill, /google_link:\s*null/);
  assert.match(activityLinkAutofill, /google_place_uri:\s*null/);
  assert.match(activityLinkAutofill, /activity\s*=\s*basicWebsiteListing\(resolvedLink\)/);
});

test('a parent can update an existing quick review', () => {
  assert.match(app, /from\('activity_reviews'\)\.upsert\(/);
  assert.match(app, /onConflict:\s*'activity_id,user_id'/);
});

test('signed-in swipe and shortlist decisions use the existing secured tables', () => {
  assert.match(app, /from\('activity_swipes'\)\s*\.upsert\(/);
  assert.match(app, /from\('activity_shortlist'\)\.upsert\(/);
  assert.match(app, /syncPlanningDecisions/);
});

test('sign-out clears account planning state from the device', () => {
  assert.match(app, /setCalendarEvents\(\[\]\);\s*setCalendarSyncedUserId\(null\);\s*setPlanningSyncedUserId\(null\);/);
});
