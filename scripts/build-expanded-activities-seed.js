/* global process */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pdfTextPath = join(repoRoot, 'tmp-wf-media-11253.txt');
const pdfBinaryPath = join(repoRoot, 'tmp-wf-media-11253.bin');
const bestStartOnly = process.argv.includes('--best-start-only');
const useLegacyBestStartPdf = process.argv.includes('--legacy-best-start-pdf');
const outputSqlPath = join(
  repoRoot,
  'supabase',
  'seed',
  bestStartOnly ? 'activities_waltham_forest_best_start_2026.generated.sql' : 'activities_expanded_family_sources.generated.sql',
);

const sourcePdfUrl = 'https://www.walthamforest.gov.uk/media/11253';
const transitionDirectoryUrl = 'https://www.transitionleytonstone.org.uk/green-directory';
const availabilityStartDate = '2026-04-01';
const availabilityEndDate = '2026-08-31';
const termStartDate = '2026-04-13';
const termEndDate = '2026-07-20';
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const monthNumbers = new Map([
  ['january', '01'], ['february', '02'], ['march', '03'], ['april', '04'],
  ['may', '05'], ['june', '06'], ['july', '07'], ['august', '08'],
  ['september', '09'], ['october', '10'], ['november', '11'], ['december', '12'],
]);

const transitionUseCaseSlugs = [
  'church-lane-community-garden',
  'cups-%26-jars',
  'geek-cafe',
  'kinship-in-nature',
  'perky-blenders',
  'stone-mini-market',
  'tamping-grounds',
  'the-library-for-change',
  'wren-wildlife-and-conservation-group',
];

const happityTargets = [
  'https://www.happity.co.uk/waltham-forest/baby-toddler-classes',
  'https://www.happity.co.uk/hackney/baby-toddler-classes',
  'https://www.happity.co.uk/islington/baby-toddler-classes',
  'https://www.happity.co.uk/newham/baby-toddler-classes',
  ...['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'].flatMap((weekday) => [
    `https://www.happity.co.uk/waltham-forest/baby-toddler-classes?weekday=${weekday}`,
    `https://www.happity.co.uk/hackney/baby-toddler-classes?weekday=${weekday}`,
    `https://www.happity.co.uk/islington/baby-toddler-classes?weekday=${weekday}`,
    `https://www.happity.co.uk/newham/baby-toddler-classes?weekday=${weekday}`,
  ]),
];

const knownBestStartNames = [
  'Antenatal Breastfeeding Workshop: Preparing to Feed my Baby',
  'Baby Feeding Group',
  'Baby Massage',
  'Bambini Music and Play (0-1)',
  'Bongalong',
  'Book and Craft',
  'Child Health Clinic Drop-In',
  'Community Drop-In',
  'Crafty Families',
  "Dads' Club",
  "Dads' Coffee Morning Stay and Play",
  "Dads' Stay and Play",
  'Dental Drop-In at the Library',
  'Duplo Club',
  'Eating Well',
  'Exploring Foods',
  'Film Club',
  'Flourish',
  "Grandparents' Group",
  'Grow Wild Explorer',
  'Healthy Eating and Dental Health Drop-in',
  'Healthy Families Group Programme',
  'HENRY Healthy Families Right from the Start Group Programme',
  'Infant Feeding Group Session',
  'Initial Sleep Consultation',
  "Kids' Crafts Club",
  'Learning Together Pre-school',
  'Learning Together Under-2s Programme',
  'Lego and Duplo Club',
  'Lego Club',
  "Let's Create",
  'Little Ballers',
  'Oral Health Promotion',
  'Play and Learn (0-4)',
  'Play and Learn for Under-2s',
  'SEND Lego Club',
  'Sensory Play and Learn',
  'Speech and Language Support Drop-in',
  'Starting Solids Workshop',
  'Stay and Play',
  'Stories and Rhymes',
  'Story Time',
  "Tambini's Music and Rhymes",
  'Under-2s Play Session',
  'We Are Friends',
  'You and Your New Baby',
  '123 Mini Chefs',
  'Infant feeding Support',
  'Violence Against Women and Girls (VAWG) Drop-In',
  'QuitRight Waltham Forest',
];

const excludedBestStartNames = new Set([
  'Child Health Clinic Drop-In',
  'Community Drop-In',
  'Dental Drop-In at the Library',
  'Healthy Eating and Dental Health Drop-in',
  'Initial Sleep Consultation',
  'Learning Together Pre-school',
  'Learning Together Under-2s Programme',
  'Oral Health Promotion',
  'Speech and Language Support Drop-in',
  'Violence Against Women and Girls (VAWG) Drop-In',
  'QuitRight Waltham Forest',
]);

const venueAddresses = new Map([
  ['Best Start Family Hub: Chingford', '5 Oaks Grove, Chingford, London E4 6EY'],
  ['Best Start Family Hub: Walthamstow', '313 Billet Road, Walthamstow, London E17 5PX'],
  ['Best Start Family Hub: Queens Road', '215 Queens Road, Walthamstow, London E17 8PJ'],
  ['Best Start Family Hub: Leytonstone', '2-8 Cathall Road, Leytonstone, London E11 4LF'],
  ['Chingford Health Centre', '109 York Road, Chingford, London E4 8LF'],
  ['Chingford Library', 'The Green, Chingford, London E4 7EN'],
  ['Hale End Library', 'Castle Avenue, Highams Park, London E4 9QD'],
  ['Parkside Primary School', '21 Wellington Avenue, Chingford, London E4 6RE'],
  ['Salisbury Manor Primary School', '4 Burnside Avenue, Chingford, London E4 8YJ'],
  ['Selwyn Primary', 'Selwyn Avenue, Chingford, London E4 9NE'],
  ['Barn Croft Primary School', '2 Brunel Road, Walthamstow, London E17 8SB'],
  ['Chapel End Early Years Centre', 'Brookscroft Road, Walthamstow, London E17 4LH'],
  ['Church Hill Nursery School', '47 Woodbury Road, Walthamstow, London E17 9SB'],
  ['Greenleaf Primary School', '80 Greenleaf Road, Walthamstow, London E17 6QW'],
  ['Thomas Gamuel Primary School', 'Colchester Road, Walthamstow, London E17 8LH'],
  ['Higham Hill Library', 'North Countess Road, Walthamstow, London E17 5HS'],
  ['The Lloyd Park Centre', 'Lloyd Park, Forest Road, Walthamstow, London E17 5JW'],
  ['Walthamstow Library', 'High Street, Walthamstow, London E17 7JN'],
  ['Wood Street Library', 'Forest Road, Walthamstow, London E17 3GN'],
  ['The Village Preschool E17', '48a Greenway Avenue, Walthamstow, London E17 3QN'],
  ['Barclay Primary School (Hoe Street)', '398 Hoe Street, Walthamstow, London E17 9AA'],
  ['Barclay Primary School (Canterbury Road)', '155 Canterbury Road, Leyton, London E10 6EJ'],
  ['Barclay Primary School', '398 Hoe Street, Walthamstow, London E17 9AA'],
  ['Lea Bridge Library', 'Lea Bridge Road, Leyton, London E10 7HU'],
  ['Leyton Library', 'High Road, Leyton, London E10 5QH'],
  ['Leyton Sports Ground', '2 Crawley Road, Leyton, London E10 6RJ'],
  ['Low Hall Nursery School', 'Low Hall Lane, Walthamstow, London E17 8BE'],
  ['Seddon Centre', '33 Clyde Place, Leyton, London E10 5AS'],
  ['Sybourn Primary School', 'Perth Road, Leyton, London E10 7PB'],
  ['The Grow Well Centre', '7 Saxon Close, Walthamstow, London E17 8LE'],
  ['Cornerstone Baby Bank', 'The Cornerstone, 149 Canterbury Road, Leyton, London E10 6EH'],
  ['Downsell Primary School', '134-136 Downsell Road, Leyton, London E15 2BS'],
  ['Leytonstone Library', 'Church Lane, Leytonstone, London E11 1HG'],
  ['United Free Church', '55 Wallwood Road, Leytonstone, London E11 1AY'],
]);

function normalizeText(value) {
  return String(value || '')
    .replaceAll('\ufb01', 'fi')
    .replaceAll('\ufb02', 'fl')
    .replaceAll('\u2019', "'")
    .replaceAll('\u2018', "'")
    .replaceAll('\u201c', '"')
    .replaceAll('\u201d', '"')
    .replaceAll('\u00a3', 'GBP ')
    .replaceAll('\u2013', '-')
    .replaceAll('\u2014', '-')
    .replaceAll('T uesday', 'Tuesday')
    .replaceAll('T ogether', 'Together')
    .replaceAll('T ambini', 'Tambini')
    .replaceAll('T o ', 'To ')
    .replaceAll('Y ou', 'You')
    .replaceAll('Y ears', 'Years')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  const cleanValue = normalizeText(value);
  return cleanValue ? `$$${cleanValue.replaceAll('$$', '$ $')}$$` : 'null';
}

function sqlArray(values = []) {
  const cleanValues = [...new Set(values.filter(Boolean))];
  return cleanValues.length ? `array[${cleanValues.map(sqlString).join(', ')}]` : "'{}'";
}

function sqlDateArray(values = []) {
  const cleanValues = [...new Set(values.filter(Boolean))];
  return cleanValues.length
    ? 'array[' + cleanValues.map(sqlString).join(', ') + ']::date[]'
    : "'{}'::date[]";
}

function slug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

function sourceSlug(...parts) {
  return parts.map(slug).filter(Boolean).join('-').slice(0, 160);
}

function inferPostcode(address) {
  return normalizeText(address).match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

function inferBorough(address) {
  const value = normalizeText(address).toLowerCase();
  if (/\b(e17|e10|e11|e4)\b/i.test(value)) return 'Waltham Forest';
  if (/\b(e8|e9|n1|n16|e5|e2)\b/i.test(value)) return 'Hackney';
  if (/\b(n1|n5|n7|n19)\b/i.test(value)) return 'Islington';
  if (/\b(e6|e7|e12|e13|e15|e16)\b/i.test(value)) return 'Newham';
  return 'Waltham Forest';
}

function categoryForName(name) {
  const value = normalizeText(name).toLowerCase();
  if (value.includes('family hub')) return 'Family hubs';
  if (value.includes('cafe') || value.includes('coffee')) return 'Child-friendly cafes';
  if (value.includes('museum') || value.includes('gallery')) return 'Museums & culture';
  if (value.includes('cinema')) return 'Baby & toddler cinema';
  if (value.includes('swim')) return 'Baby swimming';
  if (value.includes('yoga')) return 'Baby yoga';
  if (value.includes('story') || value.includes('rhymes')) return 'Story & rhyme time';
  if (value.includes('massage')) return 'Baby massage';
  if (value.includes('feeding') || value.includes('solids') || value.includes('dental') || value.includes('health') || value.includes('sleep')) return 'Feeding & postnatal support';
  if (value.includes('sensory')) return 'Baby sensory';
  if (value.includes('wild') || value.includes('garden') || value.includes('nature')) return 'Parks & outdoor play';
  if (value.includes('sign')) return 'Baby signing';
  if (value.includes('pilates') || value.includes('postnatal') || value.includes('buggy') || value.includes('fitness')) return 'Postnatal fitness';
  if (value.includes('dance') || value.includes('ballet') || value.includes('movement')) return 'Baby dance & movement';
  if (value.includes('music') || value.includes('bongalong') || value.includes('tambini') || value.includes('bambini')) return 'Music & singing';
  if (value.includes('soft play')) return 'Soft play';
  if (value.includes('craft') || value.includes('lego') || value.includes('duplo') || value.includes('create')) return 'Arts & crafts';
  if (value.includes('play') || value.includes('friends')) return 'Stay & play';
  if (value.includes('ballers') || value.includes('film')) return 'Family activities';
  return 'Family activities';
}

function parseTimePart(raw, fallbackPeriod = null) {
  const value = normalizeText(raw).toLowerCase().replace('noon', 'pm').replace('midday', 'pm');
  const match = value.match(/(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3] || fallbackPeriod;
  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (!period && hour < 8) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeRange(rawTime) {
  const cleaned = normalizeText(rawTime)
    .replace(/12 noon/gi, '12pm')
    .replace(/\bnoon\b/gi, '12pm')
    .replace(/\s+/g, ' ');
  const parts = cleaned.split(/\s+to\s+|\s*-\s*/i);
  if (parts.length < 2) return { start: '09:00', end: '10:00' };

  const endPeriod = parts[1].toLowerCase().includes('pm') ? 'pm' : parts[1].toLowerCase().includes('am') ? 'am' : null;
  let start = parseTimePart(parts[0], endPeriod);
  let end = parseTimePart(parts[1], endPeriod);
  if (!start || !end) return { start: '09:00', end: '10:00' };

  if (start >= end) {
    const [hour, minute] = start.split(':').map(Number);
    if (hour >= 12 && endPeriod === 'pm') start = `${String(hour - 12).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  if (start >= end) end = `${String(Math.min(Number(start.slice(0, 2)) + 1, 23)).padStart(2, '0')}:${start.slice(3)}`;
  return { start, end };
}

function lastKnownName(text) {
  const haystack = normalizeText(text).toLowerCase();
  const matches = knownBestStartNames
    .filter((name) => haystack.includes(normalizeText(name).toLowerCase()))
    .map((name) => ({ name, index: haystack.lastIndexOf(normalizeText(name).toLowerCase()) }))
    .sort((a, b) => b.index - a.index);
  return matches[0]?.name || null;
}

function normalizeLocation(rawLocation, fallbackArea) {
  let location = normalizeText(rawLocation)
    .replace(/^Best Start Family Hub:\s*$/, `Best Start Family Hub: ${fallbackArea}`)
    .replace(/^Best Start Family Hub:\s*(Chingford|Walthamstow|Queens Road|Leytonstone).*$/i, (_, hub) => `Best Start Family Hub: ${hub}`)
    .replace(/\s+\(Queens Road\)$/i, '')
    .replace(/\s+\(Canterbury Road\)$/i, ' (Canterbury Road)')
    .replace(/\s+\(Hoe Street\)$/i, ' (Hoe Street)');

  if (location === 'Best Start Family Hub:') location = `Best Start Family Hub: ${fallbackArea}`;
  if (location.includes('Best Start Family Hub') && !/(Chingford|Walthamstow|Queens Road|Leytonstone)/i.test(location)) {
    location = `Best Start Family Hub: ${fallbackArea}`;
  }
  return location;
}

function datesFromFrequency(rawFrequency) {
  const cleaned = normalizeText(rawFrequency).replace(/course\s+\d+\s*:/gi, '');
  const dates = [];
  const dateGroups = [...cleaned.matchAll(/((?:\d{1,2}\s*,?\s*)+)\s*(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi)];

  for (const group of dateGroups) {
    const month = monthNumbers.get(group[2].toLowerCase());
    const days = group[1].match(/\d{1,2}/g) || [];
    for (const day of days) dates.push(`2026-${month}-${day.padStart(2, '0')}`);
  }

  return [...new Set(dates)].sort();
}

function parseBestStartRows() {
  const rawText = readFileSync(pdfTextPath, 'utf8');
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const rows = [];
  const seen = new Set();
  let weekday = null;
  let area = 'Walthamstow';

  function headingWeekday(line) {
    const value = normalizeText(line).toLowerCase();
    return weekdayNames.find((name) => value === name.toLowerCase()
      || value.startsWith(name.toLowerCase() + name.toLowerCase())
      || value.startsWith(name.toLowerCase() + ' ')) || null;
  }

  function updateArea(line) {
    const value = normalizeText(line).toLowerCase();
    if (value.includes('chingford')) area = 'Chingford';
    else if (value.includes('leytonstone')) area = 'Leytonstone';
    else if (value.includes('leyton')) area = 'Queens Road';
    else if (value.includes('walthamstow')) area = 'Walthamstow';
  }

  function field(group, fieldName) {
    const index = group.findIndex((line) => line.toLowerCase().startsWith(`${fieldName.toLowerCase()}:`));
    if (index < 0) return '';
    const values = [group[index].replace(new RegExp(`^${fieldName}:\\s*`, 'i'), '')];
    for (let cursor = index + 1; cursor < group.length; cursor += 1) {
      const line = group[cursor];
      if (/^(Location|Age|Time|Frequency|Cost|More information):/i.test(line)) break;
      const nextLines = group.slice(cursor, cursor + 3).join(' ');
      if (
        headingWeekday(line)
        || /^(CHINGFORD|WALTHAMSTOW|LEYTONSTONE|LEYTON)\s*\(/i.test(line)
        || /sessions are subject|session explainer|see walthamforest|all sessions are free/i.test(line)
        || lastKnownName(nextLines)
        || knownBestStartNames.some((name) => normalizeText(nextLines).includes(normalizeText(name)))
      ) break;
      values.push(line);
    }
    return normalizeText(values.join(' '));
  }

  function activityNameBefore(locationIndex) {
    const context = lines.slice(Math.max(0, locationIndex - 8), locationIndex).join(' ');
    return lastKnownName(context);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const foundWeekday = headingWeekday(lines[index]);
    if (foundWeekday) weekday = foundWeekday;
    updateArea(lines[index]);
    if (!/^Location:/i.test(lines[index])) continue;

    const end = lines.findIndex((line, cursor) => cursor > index && /^Location:/i.test(line));
    const group = lines.slice(index, end < 0 ? Math.min(lines.length, index + 30) : end);
    const name = activityNameBefore(index);
    if (!name || excludedBestStartNames.has(name)) continue;

    const rawLocation = field(group, 'Location');
    const location = normalizeLocation(rawLocation, area);
    const rawTime = field(group, 'Time');
    const rawFrequency = field(group, 'Frequency');
    if (!rawTime || !rawFrequency || !location) continue;

    const rawAge = field(group, 'Age');
    const rawCost = field(group, 'Cost');
    const rawMore = field(group, 'More information');
    const address = venueAddresses.get(location) || `${location}, Waltham Forest, London`;
    const { start: startTime, end: endTime } = parseTimeRange(rawTime);
    const specificDates = datesFromFrequency(rawFrequency);
    const isWeekly = rawFrequency.toLowerCase().includes('weekly');
    const isTermTimeOnly = rawFrequency.toLowerCase().includes('term time');
    const key = `${name}|${location}|${startTime}|${endTime}|${rawFrequency}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sourceUrl = `${sourcePdfUrl}#${sourceSlug(name, location, startTime, rawFrequency)}`;
    rows.push({
      activity_name: `${name} at ${location}`,
      address,
      postcode: inferPostcode(address),
      lat: null,
      long: null,
      category: categoryForName(name),
      start_time: startTime,
      end_time: endTime,
      google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      // Each timetable row has its own stable source anchor; do not send families to the generic events page.
      website: sourceUrl,
      child_friendly_score: null,
      app_rating: null,
      number_of_reviews: 0,
      age_suitability: rawAge || 'Under-5s and families',
      borough: 'Waltham Forest',
      days_of_week: weekday ? [weekday] : [],
      recurrence_rule: isWeekly && weekday ? `FREQ=WEEKLY;BYDAY=${weekday.slice(0, 2).toUpperCase()}` : null,
      schedule_notes: rawFrequency,
      description: `${name} from Waltham Forest Best Start in Life timetable. ${rawMore || 'Check the council events page before travelling.'}`,
      cost: rawCost || (rawFrequency.toLowerCase().includes('free') ? 'Free' : 'Check source'),
      booking_required: /book|required|course|referral/i.test(`${rawFrequency} ${rawMore}`),
      source_name: 'Waltham Forest Best Start in Life timetable',
      source_url: sourceUrl,
      image_url: null,
      image_source_url: sourcePdfUrl,
      activity_date: specificDates.length === 1 ? specificDates[0] : null,
      available_dates: specificDates,
      availability_start_date: isWeekly ? (isTermTimeOnly ? termStartDate : availabilityStartDate) : null,
      availability_end_date: isWeekly ? (isTermTimeOnly ? termEndDate : availabilityEndDate) : null,
      available_days_of_week: weekday ? [weekday] : [],
      availability_type: isWeekly ? (isTermTimeOnly ? 'date_range' : 'weekly') : 'specific_dates',
      availability_notes: `Best Start timetable: ${rawFrequency}. ${isTermTimeOnly ? 'Term time shown as 13 April-20 July 2026; holiday exceptions may apply. ' : ''}Verify live details at walthamforest.gov.uk/events.`,
      public_listing_status: 'published',
    });
  }

  return rows;
}

function htmlAttr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || null;
}

function metaContent(html, property) {
  const meta = html.match(new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${property}["'][^>]*>`, 'i'))?.[0];
  return meta ? htmlAttr(meta, 'content') : null;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: {
      'User-Agent': 'Tiny Outings data importer (+local prototype)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const text = await response.text();
  return { status: response.status, url: response.url, text };
}

async function ensureBestStartPdfText() {
  if (existsSync(pdfTextPath)) return;

  console.warn(`Downloading ${sourcePdfUrl} for Waltham Forest Best Start timetable extraction.`);
  const response = await fetch(sourcePdfUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: {
      'User-Agent': 'Tiny Outings data importer (+local prototype)',
      Accept: 'application/pdf,*/*',
    },
  });
  if (!response.ok) throw new Error(`Unable to download Best Start PDF: HTTP ${response.status}`);
  writeFileSync(pdfBinaryPath, Buffer.from(await response.arrayBuffer()));

  const pythonScript = [
    'import sys',
    'from pypdf import PdfReader',
    'reader = PdfReader(sys.argv[1])',
    'text = "\\n".join(page.extract_text() or "" for page in reader.pages)',
    'open(sys.argv[2], "w", encoding="utf-8").write(text)',
  ].join('\n');
  const pythonCommand = process.env.PYTHON || 'python';
  const result = spawnSync(pythonCommand, ['-c', pythonScript, pdfBinaryPath, pdfTextPath], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `Unable to extract Best Start PDF text with Python/pypdf. Install it with "python -m pip install --user pypdf". ${result.stderr || result.stdout}`,
    );
  }
}

function parseTransitionPage(url, html) {
  const title = normalizeText(metaContent(html, 'og:title') || html.match(/<title>([^<]+)/i)?.[1] || '');
  const imageUrl = metaContent(html, 'og:image');
  const plain = decodeHtml(html);
  const contentStart = Math.max(0, plain.lastIndexOf('top of page'));
  const contentEnd = plain.indexOf('bottom of page', contentStart);
  const content = plain.slice(contentStart, contentEnd > contentStart ? contentEnd : undefined);
  const lines = content.split(/\n/).map((line) => normalizeText(line)).filter(Boolean);
  const fieldAfterLabel = (label) => {
    const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
    return index >= 0 ? lines[index + 1] || '' : '';
  };
  const address = fieldAfterLabel('Address');
  const telephone = fieldAfterLabel('Telephone Number');
  const email = fieldAfterLabel('Email Address');
  const titleIndex = lines.findIndex((line) => line === title);
  const websiteIndex = lines.findIndex((line, index) => index > titleIndex && line === 'Website');
  const description = normalizeText(
    titleIndex >= 0 && websiteIndex > titleIndex
      ? lines.slice(titleIndex + 1, websiteIndex).join(' ')
      : plain.match(/<meta name="description" content="([^"]+)/i)?.[1] || '',
  );
  const category = /library for change/i.test(title)
    ? 'Family activities'
    : /cafe|coffee|pastries|cakes|toasties|bread|food|drink|deli|bakery/i.test(`${title} ${description}`)
    ? 'Child-friendly cafes'
    : /garden|wildlife|nature/i.test(`${title} ${description}`)
      ? 'Parks & outdoor play'
      : 'Family activities';

  const useCase = /child|children|family|families|cafe|coffee|cake|toast|garden|nature|wildlife|library|community|play|social/i.test(`${title} ${description}`);
  if (!title || !useCase) return null;

  return {
    activity_name: title,
    address: address || 'Leytonstone, London',
    postcode: inferPostcode(address),
    lat: null,
    long: null,
    category,
    start_time: category === 'Child-friendly cafes' ? '09:00' : '10:00',
    end_time: category === 'Child-friendly cafes' ? '17:00' : '12:00',
    google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || `${title} Leytonstone`)}`,
    website: url,
    child_friendly_score: /child friendly/i.test(description) ? 4.5 : null,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: category === 'Child-friendly cafes' ? 'Parents, babies and families' : 'Families and children',
    borough: inferBorough(address || 'E11'),
    days_of_week: [],
    recurrence_rule: null,
    schedule_notes: 'Check opening times or session details with the venue before travelling.',
    description: [description, telephone && `Phone: ${telephone}`, email && `Email: ${email}`].filter(Boolean).join(' '),
    cost: category === 'Child-friendly cafes' ? 'Cafe purchases' : 'Check source',
    booking_required: false,
    source_name: 'Transition Leytonstone Green Directory',
    source_url: url,
    image_url: imageUrl,
    image_source_url: url,
    activity_date: null,
    available_dates: [],
    availability_start_date: null,
    availability_end_date: null,
    available_days_of_week: [],
    availability_type: 'daily',
    availability_notes: 'Local directory listing; check venue for opening times.',
    public_listing_status: 'published',
  };
}

async function parseTransitionRows() {
  const rows = [];
  for (const slugValue of transitionUseCaseSlugs) {
    const url = `${transitionDirectoryUrl}/${slugValue}`;
    const { status, text } = await fetchText(url);
    if (status >= 400) {
      console.warn(`Transition page skipped (${status}): ${url}`);
      continue;
    }
    const row = parseTransitionPage(url, text);
    if (row) rows.push(row);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return rows;
}

function parseHappityListingPage(url, html) {
  if (/Just a moment|cf_chl|Enable JavaScript and cookies/i.test(html)) {
    throw new Error('Cloudflare challenge returned instead of Happity listing HTML.');
  }

  const text = decodeHtml(html);
  const rows = [];
  const chunks = text.split(/#####\s+/).slice(1);
  for (const chunk of chunks) {
    const title = normalizeText(chunk.split('\n')[0]);
    const time = chunk.match(/(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/)?.[1];
    if (!title || !time) continue;
    const lines = chunk.split('\n').map(normalizeText).filter(Boolean);
    const venueLine = lines.find((line) => /\b(E|N)\d{1,2}\b/.test(line) && !line.includes('\u00a3')) || '';
    const ageLine = lines.find((line) => /\b(month|year|antenatal)/i.test(line)) || 'Under-5s';
    const costLine = lines.find((line) => /\u00a3|free/i.test(line)) || 'Check Happity';
    const scheduleLine = lines.find((line) => /term time|selected dates|all year|fixed course/i.test(line)) || 'Check Happity';
    const [startTime, endTime] = time.split('-').map((part) => part.trim());
    const borough = url.match(/happity\.co\.uk\/([^/]+)/)?.[1]?.replaceAll('-', ' ') || 'London';
    rows.push({
      activity_name: title,
      address: venueLine || `${title}, London`,
      postcode: inferPostcode(venueLine),
      lat: null,
      long: null,
      category: categoryForName(title),
      start_time: startTime,
      end_time: endTime,
      google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueLine || title)}`,
      website: url,
      child_friendly_score: null,
      app_rating: null,
      number_of_reviews: 0,
      age_suitability: ageLine,
      borough: borough.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      days_of_week: [],
      recurrence_rule: scheduleLine.toLowerCase().includes('term') ? 'FREQ=WEEKLY' : null,
      schedule_notes: scheduleLine,
      description: `${title} listed on Happity. Check Happity for live dates, booking and venue notes.`,
      cost: costLine,
      booking_required: true,
      source_name: 'Happity',
      source_url: `${url}#${sourceSlug(title, venueLine, startTime)}`,
      image_url: null,
      image_source_url: url,
      activity_date: null,
      available_dates: [],
      availability_start_date: null,
      availability_end_date: null,
      available_days_of_week: [],
      availability_type: scheduleLine.toLowerCase().includes('selected') ? 'specific_dates' : 'unknown',
      availability_notes: scheduleLine,
      public_listing_status: 'published',
    });
  }
  return rows;
}

async function parseHappityRows() {
  const rows = [];
  let blocked = 0;
  for (const url of happityTargets) {
    try {
      const { status, text } = await fetchText(url);
      if (status >= 400) throw new Error(`HTTP ${status}`);
      rows.push(...parseHappityListingPage(url, text));
    } catch (error) {
      blocked += 1;
      if (blocked === 1) {
        console.warn(`Happity direct scrape unavailable from this environment: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return rows;
}

function rowToSql(row) {
  const values = [
    row.activity_name,
    row.address,
    row.postcode,
    row.lat,
    row.long,
    row.category,
    row.start_time,
    row.end_time,
    row.google_link,
    row.website,
    row.child_friendly_score,
    row.app_rating,
    row.number_of_reviews,
    row.age_suitability,
    row.borough,
    row.days_of_week,
    row.recurrence_rule,
    row.schedule_notes,
    row.description,
    row.cost,
    row.booking_required,
    row.source_name,
    row.source_url,
    row.image_url,
    row.image_source_url,
    row.activity_date,
    row.available_dates,
    row.availability_start_date,
    row.availability_end_date,
    row.available_days_of_week,
    row.availability_type,
    row.availability_notes,
    row.public_listing_status,
  ];

  return `(${values.map((value, index) => {
    if (index === 3 || index === 4 || index === 10 || index === 11 || index === 12) return value ?? 'null';
    if (index === 20) return value ? 'true' : 'false';
    if (index === 15 || index === 29) return sqlArray(value);
    if (index === 26) return sqlDateArray(value);
    return sqlString(value);
  }).join(', ')})`;
}

function rowsToSql(rows) {
  const columns = [
    'activity_name',
    'address',
    'postcode',
    'lat',
    'long',
    'category',
    'start_time',
    'end_time',
    'google_link',
    'website',
    'child_friendly_score',
    'app_rating',
    'number_of_reviews',
    'age_suitability',
    'borough',
    'days_of_week',
    'recurrence_rule',
    'schedule_notes',
    'description',
    'cost',
    'booking_required',
    'source_name',
    'source_url',
    'image_url',
    'image_source_url',
    'activity_date',
    'available_dates',
    'availability_start_date',
    'availability_end_date',
    'available_days_of_week',
    'availability_type',
    'availability_notes',
    'public_listing_status',
  ];

  return `-- Generated by scripts/build-expanded-activities-seed.js
-- Sources:
-- - ${sourcePdfUrl}
-- - ${transitionDirectoryUrl}
-- - Happity target borough pages when direct access is available

insert into public.activities (
  ${columns.join(',\n  ')}
)
values
${rows.map(rowToSql).join(',\n')}
on conflict (source_url) do update set
  activity_name = excluded.activity_name,
  address = excluded.address,
  postcode = excluded.postcode,
  lat = coalesce(excluded.lat, public.activities.lat),
  long = coalesce(excluded.long, public.activities.long),
  category = excluded.category,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  google_link = excluded.google_link,
  website = excluded.website,
  child_friendly_score = excluded.child_friendly_score,
  app_rating = excluded.app_rating,
  number_of_reviews = excluded.number_of_reviews,
  age_suitability = excluded.age_suitability,
  borough = excluded.borough,
  days_of_week = excluded.days_of_week,
  recurrence_rule = excluded.recurrence_rule,
  schedule_notes = excluded.schedule_notes,
  description = excluded.description,
  cost = excluded.cost,
  booking_required = excluded.booking_required,
  source_name = excluded.source_name,
  image_url = coalesce(public.activities.image_url, excluded.image_url),
  image_source_url = coalesce(public.activities.image_source_url, excluded.image_source_url),
  activity_date = excluded.activity_date,
  available_dates = excluded.available_dates,
  availability_start_date = excluded.availability_start_date,
  availability_end_date = excluded.availability_end_date,
  available_days_of_week = excluded.available_days_of_week,
  availability_type = excluded.availability_type,
  availability_notes = excluded.availability_notes,
  public_listing_status = excluded.public_listing_status,
  updated_at = now();
`;
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row.source_url || seen.has(row.source_url)) return false;
    seen.add(row.source_url);
    return true;
  });
}

async function main() {
  // The live council events importer supersedes this historical PDF extractor.
  // Keep it behind an explicit flag only for reproducible archive research.
  if (bestStartOnly && !useLegacyBestStartPdf) {
    throw new Error('The PDF Best Start importer has been retired. Run npm run activities:best-start instead.');
  }
  if (useLegacyBestStartPdf) await ensureBestStartPdfText();
  const bestStartRows = useLegacyBestStartPdf ? parseBestStartRows() : [];
  const transitionRows = bestStartOnly ? [] : await parseTransitionRows();
  const happityRows = bestStartOnly ? [] : await parseHappityRows();
  const rows = dedupeRows([...bestStartRows, ...transitionRows, ...happityRows]);

  mkdirSync(dirname(outputSqlPath), { recursive: true });
  writeFileSync(outputSqlPath, rowsToSql(rows));

  const bySource = rows.reduce((counts, row) => {
    counts[row.source_name] = (counts[row.source_name] || 0) + 1;
    return counts;
  }, {});
  const byCategory = rows.reduce((counts, row) => {
    counts[row.category] = (counts[row.category] || 0) + 1;
    return counts;
  }, {});
  console.log(`Generated ${rows.length} rows at ${outputSqlPath}`);
  console.log(JSON.stringify({ bySource, byCategory }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
