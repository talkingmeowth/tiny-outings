/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const listingUrl = 'https://www.eventbrite.co.uk/d/united-kingdom--london/baby/';
const pageLimit = Math.max(1, Number.parseInt(process.env.EVENTBRITE_PAGE_LIMIT || '44', 10));
const pageDelayMs = Math.max(0, Number.parseInt(process.env.EVENTBRITE_PAGE_DELAY_MS || '2200', 10));
const outputSql = join(root, 'supabase', 'seed', 'activities_eventbrite_london_baby_search_cards_20260711.generated.sql');
const outputAudit = join(root, 'data', 'eventbrite_london_baby_search_cards_20260711.generated.json');
const auditInput = process.env.EVENTBRITE_AUDIT_INPUT || null;

function cleanText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

function listingPageUrl(page) {
  if (page === 1) return listingUrl;
  const url = new URL(listingUrl);
  url.searchParams.set('page', String(page));
  return url.toString();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchHtml(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (response.ok) return response.text();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(`Eventbrite returned ${response.status}`);
    }
    await delay(2000 * (attempt + 1));
  }
  throw new Error('Eventbrite request failed after retries.');
}

function parseStart(label) {
  const value = cleanText(label).replace(/\s*\+\s*\d+\s+more$/i, '');
  const match = value.match(/^(Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+[A-Z][a-z]{2}\s+\d{1,2})(?:,?\s+(\d{4}))?(?:\s+at|,)?\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return null;

  const today = new Date();
  let year = Number(match[2]) || today.getFullYear();
  let month = today.getMonth();
  let day = today.getDate();
  const dateLabel = match[1].toLowerCase();
  if (dateLabel === 'tomorrow') {
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    year = tomorrow.getFullYear();
    month = tomorrow.getMonth();
    day = tomorrow.getDate();
  } else if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(dateLabel)) {
    const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dateLabel);
    const daysAhead = (targetDay - today.getDay() + 7) % 7;
    const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead);
    year = next.getFullYear();
    month = next.getMonth();
    day = next.getDate();
  } else if (dateLabel !== 'today') {
    const dateMatch = match[1].match(/[A-Z][a-z]{2}\s+(\d{1,2})$/);
    const monthName = match[1].match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+([A-Z][a-z]{2})/)?.[1];
    month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthName);
    day = Number(dateMatch?.[1]);
    if (month < today.getMonth() - 6) year += 1;
  }

  let hour = Number(match[3]);
  if (match[5].toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[5].toUpperCase() === 'AM' && hour === 12) hour = 0;
  const date = new Date(year, month, day, hour, Number(match[4]));
  if (Number.isNaN(date.valueOf())) return null;
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    startTime: `${String(hour).padStart(2, '0')}:${match[4]}`,
  };
}

function categoryFor(name) {
  const text = String(name || '').toLowerCase();
  if (/(music|sing|rhyme|concert|bach to baby)/.test(text)) return 'Music & singing';
  if (/(sensory|squish)/.test(text)) return 'Baby sensory';
  if (/(yoga|pilates|barre|fitness|padel)/.test(text)) return 'Postnatal fitness';
  if (/(walk|outdoor)/.test(text)) return 'Parks & outdoor play';
  if (/(stay and play|play session|playgroup|soft play)/.test(text)) return 'Stay & play';
  if (/(cinema|comedy|quiz|cafe|brunch|meetup)/.test(text)) return 'Parent meet-ups';
  return 'Family activities';
}

function boroughFor(address) {
  const text = String(address || '').toUpperCase();
  if (/\b(E10|E11|E17)\b/.test(text)) return 'Waltham Forest';
  if (/\b(E2|E5|E8|E9|N16)\b/.test(text)) return 'Hackney';
  if (/\b(N1|N5|N7|N19|EC1)\b/.test(text)) return 'Islington';
  if (/\b(E6|E7|E12|E13|E15|E16|E20)\b/.test(text)) return 'Newham';
  return 'London';
}

function extractCards(html) {
  const cards = new Map();
  const marker = 'data-testid="search-event"';
  let position = 0;
  while ((position = html.indexOf(marker, position)) >= 0) {
    const startIndex = html.lastIndexOf('<li', position);
    const endIndex = html.indexOf('</li>', position);
    const cardHtml = html.slice(startIndex, endIndex + 5);
    position += marker.length;
    const url = cleanText(cardHtml.match(/https:\/\/www\.eventbrite\.co\.uk\/e\/[^"?<>\s]+/)?.[0]);
    const eventId = cardHtml.match(/data-event-id="(\d+)"/)?.[1];
    const imageUrl = cleanText(cardHtml.match(/<img[^>]+class="event-card-image"[^>]+src="([^"]+)"/)?.[1]);
    const name = cleanText(cardHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
    const labels = [...cardHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((match) => cleanText(match[1]));
    const dateIndex = labels.findIndex((label) => parseStart(label));
    const startLabel = labels[dateIndex];
    const locationLabel = labels[dateIndex + 1];
    const start = parseStart(startLabel);
    if (!url || !eventId || !name || !start) continue;
    const venue = locationLabel.replace(/^London\s*[·-]\s*/i, '').trim();
    const address = venue ? `${venue}, London` : 'London';
    cards.set(eventId, { eventId, url, imageUrl, name, address, startLabel, start });
  }
  return [...cards.values()];
}

const columns = [
  'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website',
  'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'recurrence_rule',
  'schedule_notes', 'description', 'cost', 'booking_required', 'source_name', 'source_url', 'image_url', 'image_source_url',
  'activity_date', 'available_dates', 'availability_start_date', 'availability_end_date', 'available_days_of_week',
  'availability_type', 'availability_notes', 'public_listing_status',
];

function rowFor(card) {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date(`${card.start.date}T12:00:00`));
  const startHour = Number(card.start.startTime.slice(0, 2));
  const endTime = startHour === 23
    ? '23:59'
    : `${String(startHour + 1).padStart(2, '0')}:${card.start.startTime.slice(3)}`;
  return {
    activity_name: card.name,
    address: card.address,
    postcode: null,
    lat: null,
    long: null,
    category: categoryFor(card.name),
    start_time: card.start.startTime,
    end_time: endTime,
    google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}`,
    website: card.url,
    child_friendly_score: null,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: 'Parents, babies and young children',
    borough: boroughFor(card.address),
    days_of_week: [day],
    recurrence_rule: null,
    schedule_notes: 'Eventbrite listing. Check Eventbrite for final times, venue details and booking.',
    description: `Eventbrite listing: ${card.name}. Open Eventbrite for the complete event details.`,
    cost: 'Check Eventbrite',
    booking_required: true,
    source_name: 'Eventbrite London baby listings',
    source_url: card.url,
    image_url: card.imageUrl,
    image_source_url: card.url,
    activity_date: card.start.date,
    available_dates: [card.start.date],
    availability_start_date: null,
    availability_end_date: null,
    available_days_of_week: [day],
    availability_type: 'one_off',
    availability_notes: `${card.startLabel}. Check Eventbrite before travelling.`,
    public_listing_status: 'published',
  };
}

function rowSql(row) {
  return columns.map((column) => {
    const value = row[column];
    if (['lat', 'long', 'child_friendly_score', 'app_rating', 'number_of_reviews'].includes(column)) return value ?? 'null';
    if (column === 'available_dates') return `${sqlArray(value)}::date[]`;
    if (['days_of_week', 'available_days_of_week'].includes(column)) return sqlArray(value);
    if (column === 'booking_required') return value ? 'true' : 'false';
    return sql(value);
  }).join(', ');
}

function buildSql(rows) {
  return `-- Generated by scripts/import-eventbrite-baby-search-cards.js\n-- Source: ${listingUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n${rows.map((row) => `(${rowSql(row)})`).join(',\n')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  category = excluded.category,\n  start_time = excluded.start_time,\n  end_time = excluded.end_time,\n  website = excluded.website,\n  days_of_week = excluded.days_of_week,\n  schedule_notes = excluded.schedule_notes,\n  description = excluded.description,\n  cost = excluded.cost,\n  image_url = excluded.image_url,\n  image_source_url = excluded.image_source_url,\n  activity_date = excluded.activity_date,\n  available_dates = excluded.available_dates,\n  available_days_of_week = excluded.available_days_of_week,\n  availability_type = excluded.availability_type,\n  availability_notes = excluded.availability_notes,\n  public_listing_status = 'published',\n  updated_at = now();\n`;
}

async function main() {
  const cards = new Map();
  const failures = [];
  let pagesCompleted = 0;
  if (auditInput) {
    const audit = JSON.parse(readFileSync(auditInput, 'utf8'));
    (audit.cards || []).forEach((card) => {
      cards.set(card.eventId, card);
    });
    pagesCompleted = Number(audit.failures?.[0]?.page) - 1 || Number(audit.pages_completed) || 0;
    failures.push(...(audit.failures || []));
  } else {
    for (let page = 1; page <= pageLimit; page += 1) {
      try {
        const pageCards = extractCards(await fetchHtml(listingPageUrl(page)));
        pageCards.forEach((card) => cards.set(card.eventId, card));
        pagesCompleted += 1;
        console.log(`${page}/${pageLimit}: ${cards.size} unique Eventbrite listings`);
        if (page < pageLimit) await delay(pageDelayMs);
      } catch (error) {
        failures.push({ page, reason: error.message });
        console.warn(`${page}/${pageLimit}: ${error.message}`);
        break;
      }
    }
  }

  const rows = [...cards.values()].map(rowFor).sort((left, right) => left.activity_date.localeCompare(right.activity_date) || left.start_time.localeCompare(right.start_time));
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({
    listing_url: listingUrl,
    generated_at: new Date().toISOString(),
    pages_requested: pageLimit,
    pages_completed: pagesCompleted,
    failures,
    cards: [...cards.values()],
    rows,
  }, null, 2) + '\n');
  console.log(`Generated ${rows.length} Eventbrite search-card records.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
