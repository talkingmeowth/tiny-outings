import {
  ageForFamilyHubSession,
  categoryForFamilyHubSession,
  cleanText,
  isFamilyActivitySession,
  normalisePostcode,
  parseTimeRanges,
  weekdayFromHeading,
} from './family-hub-timetable-policy.js';

export const greenwichFamilyDirectoryBaseUrl = 'https://greenwichcommunitydirectory.org.uk';
export const greenwichFamilyDirectorySitemapUrl = `${greenwichFamilyDirectoryBaseUrl}/sitemap.xml`;

const centreSlugs = ['brookhill', 'quaggy', 'storkway', 'waterways'];
const targetPostcodes = new Set(['SE186BD', 'SE137QZ', 'SE39QX', 'SE288EZ']);
const monthNumbers = new Map([
  ['january', '01'], ['february', '02'], ['march', '03'], ['april', '04'], ['may', '05'], ['june', '06'],
  ['july', '07'], ['august', '08'], ['september', '09'], ['october', '10'], ['november', '11'], ['december', '12'],
]);

function absoluteUrl(value) {
  try {
    return new URL(String(value || '').replaceAll('&amp;', '&'), greenwichFamilyDirectoryBaseUrl).toString();
  } catch {
    return null;
  }
}

function metaContent(html, name) {
  const tags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of tags) {
    const candidate = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1];
    if (candidate?.toLowerCase() !== name.toLowerCase()) continue;
    return cleanText(tag.match(/content=["']([^"']*)["']/i)?.[1]);
  }
  return '';
}

function sectionAfterHeading(html, heading) {
  const matcher = new RegExp(`<h2\\b[^>]*>\\s*${heading}\\s*<\\/h2>`, 'i');
  const match = matcher.exec(html);
  if (!match) return '';
  const start = match.index + match[0].length;
  const end = html.indexOf('<div class="rbg-service-details__item">', start);
  return html.slice(start, end > start ? end : html.length);
}

function isoDate(day, month, year) {
  const monthNumber = monthNumbers.get(String(month || '').toLowerCase());
  if (!monthNumber) return null;
  return `${year}-${monthNumber}-${String(day).padStart(2, '0')}`;
}

function exactDates(block, today) {
  const dates = [];
  const matcher = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi;
  for (const match of block.matchAll(matcher)) {
    const date = isoDate(match[1], match[2], match[3]);
    if (date && date >= today) dates.push(date);
  }
  return [...new Set(dates)].sort();
}

function eventGroups(dateAndTimeBlock) {
  const matches = [...dateAndTimeBlock.matchAll(/<div\b[^>]*class=["'][^"']*event-group[^"']*["'][^>]*>/gi)];
  return matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? dateAndTimeBlock.length;
    return dateAndTimeBlock.slice(match.index + match[0].length, end);
  });
}

export function discoverGreenwichFamilyDirectoryUrls(sitemapXml) {
  const urls = new Set();
  for (const match of String(sitemapXml || '').matchAll(/<loc>(https:\/\/greenwichcommunitydirectory\.org\.uk\/services\/[^<]+)<\/loc>/gi)) {
    const url = absoluteUrl(match[1]);
    if (url && centreSlugs.some((slug) => url.toLowerCase().includes(slug))) urls.add(url);
  }
  return [...urls].sort();
}

export function parseGreenwichFamilyDirectoryPage(url, html, today = new Date().toISOString().slice(0, 10)) {
  const activityName = cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const description = metaContent(html, 'description');
  if (!isFamilyActivitySession(activityName, description)) return [];

  const postcode = normalisePostcode(html.match(/class=["'][^"']*postal-code[^"']*["'][^>]*>([^<]+)</i)?.[1]);
  if (!targetPostcodes.has(postcode)) return [];

  const ageDetails = cleanText(sectionAfterHeading(html, 'Suitable for'));
  const bookingDetails = cleanText(sectionAfterHeading(html, 'How to book'));
  const costDetails = cleanText(sectionAfterHeading(html, 'Cost')) || 'Free';
  const dateAndTime = sectionAfterHeading(html, 'Date and time');
  const rows = [];
  for (const group of eventGroups(dateAndTime)) {
    const heading = cleanText(group.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1]);
    const day = weekdayFromHeading(heading.match(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i)?.[0]);
    const dates = exactDates(group, today);
    if (!day || !dates.length) continue;
    const ranges = parseTimeRanges(cleanText(group));
    for (const [index, range] of ranges.entries()) {
      rows.push({
        hub_postcode: postcode,
        venue_postcode: postcode,
        venue_address: null,
        activity_name: ranges.length > 1 ? `${activityName} - session ${index + 1}` : activityName,
        day,
        start_time: range.start_time,
        end_time: range.end_time,
        age_suitability: ageForFamilyHubSession(activityName, ageDetails || description),
        category: categoryForFamilyHubSession(activityName, description),
        description,
        cost: costDetails,
        booking_required: !/no booking required|drop[ -]?in/i.test(bookingDetails),
        source_page_url: absoluteUrl(url),
        availability_start_date: dates[0],
        availability_end_date: dates.at(-1),
        available_dates: dates,
        excluded_dates: [],
        schedule_notes: 'Exact upcoming dates published by the Royal Borough of Greenwich Community Directory. Check the source page for later dates and changes.',
      });
    }
  }
  return rows;
}

export async function loadGreenwichFamilyDirectorySessions(fetchText, today = new Date().toISOString().slice(0, 10)) {
  const urls = discoverGreenwichFamilyDirectoryUrls(await fetchText(greenwichFamilyDirectorySitemapUrl));
  const rows = [];
  const audit = [];
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      const url = urls[index];
      try {
        const parsed = parseGreenwichFamilyDirectoryPage(url, await fetchText(url), today);
        rows.push(...parsed);
        audit.push({ url, status: parsed.length ? 'ready' : 'skipped', sessions: parsed.length });
      } catch (error) {
        audit.push({ url, status: 'failed', sessions: 0, reason: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  return { rows, audit: audit.sort((left, right) => left.url.localeCompare(right.url)), discovered: urls.length };
}
