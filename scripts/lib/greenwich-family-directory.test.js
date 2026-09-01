import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverGreenwichFamilyDirectoryUrls,
  parseGreenwichFamilyDirectoryPage,
} from './greenwich-family-directory.js';

test('discovers only target-centre service pages from the Greenwich sitemap', () => {
  const sitemap = `
    <loc>https://greenwichcommunitydirectory.org.uk/services/stay-play-storkway-childrens-centre</loc>
    <loc>https://greenwichcommunitydirectory.org.uk/services/baby-group-brookhill-childrens-centre</loc>
    <loc>https://greenwichcommunitydirectory.org.uk/services/unrelated-service</loc>
  `;
  assert.deepEqual(discoverGreenwichFamilyDirectoryUrls(sitemap), [
    'https://greenwichcommunitydirectory.org.uk/services/baby-group-brookhill-childrens-centre',
    'https://greenwichcommunitydirectory.org.uk/services/stay-play-storkway-childrens-centre',
  ]);
});

test('parses exact future dates and times from a Greenwich activity page', () => {
  const html = `
    <meta name="description" content="Meet other parents and play with your child." />
    <h1>Stay &amp; Play at Storkway Children's Centre</h1>
    <div class="rbg-service-details__item"><h2>Suitable for</h2><li>Ages 0 to 4</li></div>
    <div class="rbg-service-details__item"><h2>Date and time</h2>
      <div class="event-group"><strong>Every Monday starting 3 November 2025:</strong>
        <li>10:00am to 11:30am</li><li>Monday 31 August 2026</li>
        <li>Monday 07 September 2026</li><li>Monday 14 September 2026</li>
      </div>
    </div>
    <div class="rbg-service-details__item"><h2>Cost</h2><li>Family £1 per session</li></div>
    <div class="rbg-service-details__item"><h2>How to book</h2><li>No booking required</li></div>
    <span class="postal-code">SE3 9QX</span>
  `;
  assert.deepEqual(parseGreenwichFamilyDirectoryPage(
    'https://greenwichcommunitydirectory.org.uk/services/stay-play-storkway-childrens-centre',
    html,
    '2026-09-01',
  ), [{
    hub_postcode: 'SE39QX',
    venue_postcode: 'SE39QX',
    venue_address: null,
    activity_name: "Stay & Play at Storkway Children's Centre",
    day: 'Monday',
    start_time: '10:00',
    end_time: '11:30',
    age_suitability: '0 to 4 years',
    category: 'Stay & play',
    description: 'Meet other parents and play with your child.',
    cost: 'Family £1 per session',
    booking_required: false,
    source_page_url: 'https://greenwichcommunitydirectory.org.uk/services/stay-play-storkway-childrens-centre',
    availability_start_date: '2026-09-07',
    availability_end_date: '2026-09-14',
    available_dates: ['2026-09-07', '2026-09-14'],
    excluded_dates: [],
    schedule_notes: 'Exact upcoming dates published by the Royal Borough of Greenwich Community Directory. Check the source page for later dates and changes.',
  }]);
});
