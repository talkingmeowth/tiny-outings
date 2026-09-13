const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortWeekdays = new Map([
  ['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['tues', 'Tuesday'],
  ['wed', 'Wednesday'], ['weds', 'Wednesday'], ['thu', 'Thursday'], ['thur', 'Thursday'],
  ['thurs', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'],
]);
const monthNumbers = new Map([
  ['january', '01'], ['february', '02'], ['march', '03'], ['april', '04'], ['may', '05'], ['june', '06'],
  ['july', '07'], ['august', '08'], ['september', '09'], ['october', '10'], ['november', '11'], ['december', '12'],
]);

export function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&ndash;|&#8211;|&mdash;|&#8212;/gi, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function htmlTitle(html) {
  return cleanText(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
}

function recordsFromJsonLd(value, output) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => recordsFromJsonLd(entry, output));
    return;
  }
  if (value['@type']) output.push(value);
  if (value['@graph']) recordsFromJsonLd(value['@graph'], output);
}

export function jsonLdRecords(html) {
  const records = [];
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      recordsFromJsonLd(JSON.parse(match[1]), records);
    } catch {
      // A malformed analytics block must not invalidate an otherwise healthy page.
    }
  }
  return records;
}

function hasType(record, wanted) {
  const types = Array.isArray(record?.['@type']) ? record['@type'] : [record?.['@type']];
  return types.some((type) => String(type || '').toLowerCase() === wanted.toLowerCase());
}

export function eventRecord(html) {
  return jsonLdRecords(html).find((record) => hasType(record, 'Event')) || null;
}

function zonedParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday,
  };
}

export function localToday(now = new Date()) {
  return zonedParts(now)?.date || now.toISOString().slice(0, 10);
}

function eventStatus(record) {
  return String(record?.eventStatus || '').toLowerCase();
}

function firstOffer(record) {
  return Array.isArray(record?.offers) ? record.offers[0] : record?.offers;
}

export function scheduleFromEvent(record, { now = new Date(), pageHtml = '' } = {}) {
  if (!record) return { state: 'unknown', reason: 'No Event structured data' };
  const status = eventStatus(record);
  if (status.includes('eventcancelled') || status === 'cancelled') {
    return { state: 'stale', reason: 'The authoritative listing is marked cancelled' };
  }

  const offerAvailability = String(firstOffer(record)?.availability || '').toLowerCase();
  if (offerAvailability.includes('discontinued')) {
    return { state: 'stale', reason: 'The authoritative listing is marked discontinued' };
  }

  const start = zonedParts(record.startDate);
  const end = zonedParts(record.endDate || record.startDate);
  const today = localToday(now);
  const series = /"isSeries"\s*:\s*true/i.test(pageHtml);
  const nextSessionValue = String(pageHtml || '').match(/"nextAvailableSession"\s*:\s*"([^"]+)"/i)?.[1];
  const nextSession = zonedParts(nextSessionValue);

  // Eventbrite series pages describe the whole series in JSON-LD. Prefer the
  // explicit next session when it is current; never replace a useful next date
  // with the historical series start.
  if (series && nextSession?.date >= today) {
    const duration = start && end && record.startDate && record.endDate
      ? Math.max(0, new Date(record.endDate).valueOf() - new Date(record.startDate).valueOf())
      : 0;
    const nextEnd = duration > 0 && duration < 24 * 60 * 60 * 1000
      ? zonedParts(new Date(new Date(nextSessionValue).valueOf() + duration))
      : null;
    return {
      state: 'active',
      kind: 'specific-date',
      name: cleanText(record.name),
      date: nextSession.date,
      start: nextSession.time,
      end: nextEnd?.time || null,
      days: [nextSession.weekday],
      reason: 'Current next session from the authoritative event page',
    };
  }

  if (!start) return { state: 'active', kind: 'no-schedule', name: cleanText(record.name) };
  if (start.date < today && end?.date >= today) {
    return { state: 'active', kind: series ? 'series' : 'date-range', name: cleanText(record.name), reason: 'Authoritative event date range remains active' };
  }
  if (end?.date < today) {
    return { state: 'stale', reason: 'The authoritative event date has elapsed', name: cleanText(record.name) };
  }
  if (end?.date && end.date !== start.date) {
    return { state: 'active', kind: series ? 'series' : 'date-range', name: cleanText(record.name), reason: 'Authoritative multi-day event date range remains active' };
  }
  const endTime = end?.time !== start.time ? end?.time || null : null;
  return {
    state: 'active',
    kind: 'specific-date',
    name: cleanText(record.name),
    date: start.date,
    start: start.time,
    end: endTime,
    days: [start.weekday],
    reason: 'Current date and time from Event structured data',
  };
}

function parseClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = match[3]?.toLowerCase();
  if (suffix === 'pm' && hour !== 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseHappityReaderPage(markdown) {
  const title = cleanText(String(markdown || '').match(/^Title:\s*(.+)$/mi)?.[1]);
  if (!title) return { state: 'unknown', reason: 'The Happity reader returned no title' };
  if (/^find baby classes|^baby & toddler classes|^happity\s*[-|]/i.test(title)) {
    return { state: 'stale', reason: 'The Happity schedule URL now resolves to the generic directory', title };
  }
  const match = title.match(/^(.*?),\s*(Sun|Mon|Tue|Tues|Wed|Weds|Thu|Thur|Thurs|Fri|Sat)\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*[-–—]/i);
  if (!match) return { state: 'active', kind: 'no-schedule', title };
  const day = shortWeekdays.get(match[2].toLowerCase());
  const start = parseClock(match[3]);
  const end = parseClock(match[4]);
  if (!day || !start || !end) return { state: 'active', kind: 'no-schedule', title };
  return {
    state: 'active',
    kind: 'weekly',
    name: cleanText(match[1]),
    start,
    end,
    days: [day],
    title,
    reason: 'Current weekday and time from the live Happity schedule title',
  };
}

function labelledValue(html, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`details-block__label[^>]*>\\s*${escaped}\\s*<\\/div>\\s*<div[^>]*details-block__value[^>]*>([\\s\\S]*?)<\\/div>`, 'i');
  return cleanText(String(html || '').match(matcher)?.[1]);
}

export function parseWalthamForestEventPage(html, { now = new Date() } = {}) {
  const value = labelledValue(html, 'Event date:');
  const match = value.match(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (!match) return { state: 'active', kind: 'no-schedule' };
  const month = monthNumbers.get(match[2].toLowerCase());
  const date = `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
  if (date < localToday(now)) return { state: 'stale', reason: 'The council event date has elapsed' };
  const parsedDate = new Date(`${date}T12:00:00Z`);
  return {
    state: 'active', kind: 'specific-date', date,
    start: parseClock(match[4]), end: parseClock(match[5]),
    days: [weekdays[parsedDate.getUTCDay()]],
    reason: 'Current date and time from the council event page',
  };
}

export function pageExplicitlyMissing(html) {
  const title = htmlTitle(html);
  return /(?:page|event|listing)\s+(?:not found|does not exist)|no longer available|event cancelled|this event has ended/i.test(title);
}

export function scheduleDiffers(activity, schedule) {
  if (!schedule || !['weekly', 'specific-date'].includes(schedule.kind)) return false;
  const sameTime = (value, expected) => !expected || String(value || '').slice(0, 5) === expected;
  const currentDays = [...(activity.days_of_week || [])].sort().join('|');
  const wantedDays = [...(schedule.days || [])].sort().join('|');
  if (!sameTime(activity.start_time, schedule.start) || !sameTime(activity.end_time, schedule.end)) return true;
  if (wantedDays && currentDays !== wantedDays) return true;
  return schedule.kind === 'specific-date' && activity.activity_date !== schedule.date;
}
