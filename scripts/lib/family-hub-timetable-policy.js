const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const excludedSessionName = /(?:advice|appointment|assessment|antenatal checks?|benefit|bcg|citizen(?:'s|s)? advice|clinic|community midwi|development checks?|dwp|employment|family information|family navigator|family store|health checks?|health review|health visitor|housing|job club|maternal mood|midwi|parent\s*-?\s*infant psychotherapy|perinatal mental health|registration|support hubs? \(fish\)|vaccination|welfare benefits?|youth outreach)/i;

const activitySessionName = /(?:baby|babies|breastfeeding support|chatter|childminders? (?:group|session)|connect and babble|dance|explorers?|feeding support|forest school|fun for all|games afternoon|gardening club|get together|giggles|learn and play|little|massage|messy|music|musical|nurture|outdoor stay|play|rhyme|sensory|sing|small steps|starting solids|story|toddler|together|twinkle|wiggle|yoga)/i;

export const weekdays = Object.freeze([...weekdayNames]);

export function cleanText(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
    .replace(/&ndash;|&mdash;|&#8211;|&#8212;/gi, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalisePostcode(value) {
  return cleanText(value).replace(/\s+/g, '').toUpperCase();
}

function clockParts(value, inheritedMeridiem = null) {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/midday|noon/g, '12pm')
    .replace(/midnight/g, '12am')
    .replace(/\./g, ':');
  const match = normalized.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase() || inheritedMeridiem;
  if (hour > 24 || minute > 59) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour === 24 && minute === 0) hour = 0;
  if (hour > 23) return null;
  return {
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    meridiem,
    explicitMeridiem: Boolean(match[3]),
  };
}

export function parseTimeRange(value) {
  const normalized = cleanText(value)
    .replace(/[–—]/g, '-')
    .replace(/\b(?:midday|noon)\b/gi, '12pm')
    .replace(/\bmidnight\b/gi, '12am');
  const token = '(\\d{1,2}(?:(?::|\\.)\\d{1,2})?\\s*(?:am|pm)?)';
  // A bare numeric range is normally an age ("0-5", "1 to 2") rather
  // than a time. Find the first range that itself contains a meridiem or
  // minute separator, instead of accepting clock evidence elsewhere nearby.
  const match = [...normalized.matchAll(new RegExp(`${token}\\s*(?:to|-)\\s*${token}`, 'gi'))]
    .find((candidate) => /(?:am|pm|\d[.:]\d)/i.test(candidate[0]));
  if (!match) return null;
  const endMeridiem = match[2].match(/(am|pm)/i)?.[1]?.toLowerCase() || null;
  const start = clockParts(match[1], endMeridiem);
  const end = clockParts(match[2], start?.meridiem);
  if (!start || !end) return null;

  let startTime = start.time;
  let endTime = end.time;
  const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
  if (endMinutes <= startMinutes && !match[1].match(/(am|pm)/i) && endMeridiem === 'pm' && startMinutes >= 12 * 60) {
    const correctedHour = Number(startTime.slice(0, 2)) - 12;
    startTime = `${String(correctedHour).padStart(2, '0')}:${startTime.slice(3)}`;
  }

  const correctedStartMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  const correctedEndMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
  if (correctedEndMinutes <= correctedStartMinutes) return null;
  return { start_time: startTime, end_time: endTime };
}

export function parseTimeRanges(value) {
  const normalized = cleanText(value).replace(/[–—]/g, '-');
  const token = '\\d{1,2}(?:(?::|\\.)\\d{1,2})?\\s*(?:am|pm)?';
  const matches = normalized.match(new RegExp(`${token}\\s*(?:to|-)\\s*${token}`, 'gi')) || [];
  const unique = new Map();
  for (const match of matches) {
    const parsed = parseTimeRange(match);
    if (parsed) unique.set(`${parsed.start_time}-${parsed.end_time}`, parsed);
  }
  return [...unique.values()];
}

export function isFamilyActivitySession(name, details = '') {
  const title = cleanText(name);
  const body = cleanText(details);
  if (!title || excludedSessionName.test(title)) return false;
  return activitySessionName.test(`${title} ${body}`);
}

export function categoryForFamilyHubSession(name, details = '') {
  const text = `${cleanText(name)} ${cleanText(details)}`.toLowerCase();
  if (/baby massage|massage.*baby/.test(text)) return 'Baby massage';
  if (/sensory/.test(text)) return 'Baby sensory';
  if (/stay\s*(?:&|and)\s*play|learn and play|play and learn|playgroup|fun for all|small steps|get together/.test(text)) return 'Stay & play';
  if (/rhyme|story|book/.test(text)) return 'Story & rhyme time';
  if (/music|musical|sing|wiggle|dance|twinkle/.test(text)) return 'Music & singing';
  if (/breastfeeding|feeding support|starting solids|nurture|postnatal/.test(text)) return 'Feeding & postnatal support';
  if (/messy|craft/.test(text)) return 'Arts & crafts';
  if (/forest|garden|nature|outdoor/.test(text)) return 'Parks & outdoor play';
  if (/explor|development|together|chatter/.test(text)) return 'Developmental play';
  return 'Family activities';
}

export function ageForFamilyHubSession(name, details = '') {
  const text = cleanText(`${name} ${details}`);
  const explicit = text.match(/(?:age|ages?)\s*:?\s*([^.;]+?)(?=(?:\s+(?:time|session|booking|notes?)\s*:)|$)/i)?.[1];
  if (explicit) return cleanText(explicit);
  const range = text.match(/(?:newborn|birth|\d+\s*(?:weeks?|months?|years?))\s*(?:to|-)\s*(?:under\s*)?\d+\s*(?:weeks?|months?|years?)/i)?.[0];
  if (range) return cleanText(range);
  if (/under\s*1|0\s*(?:to|-)\s*12\s*months?|bab(?:y|ies)/i.test(text)) return 'Babies under 1';
  if (/under\s*5|0\s*(?:to|-)\s*(?:4|5)\s*years?/i.test(text)) return 'Parents and children under 5';
  return 'Parents, babies and young children';
}

export function weekdayFromHeading(value) {
  const normalized = cleanText(value).replace(/s$/i, '');
  return weekdayNames.find((day) => day.toLowerCase() === normalized.toLowerCase()) || null;
}

export function validateFamilyHubSession(session) {
  const errors = [];
  if (!cleanText(session.activity_name)) errors.push('missing activity name');
  if (!normalisePostcode(session.hub_postcode)) errors.push('missing hub postcode');
  if (!weekdayNames.includes(session.day)) errors.push('missing or invalid weekday');
  if (!/^\d{2}:\d{2}$/.test(session.start_time || '')) errors.push('missing or invalid start time');
  if (!/^\d{2}:\d{2}$/.test(session.end_time || '')) errors.push('missing or invalid end time');
  if (!/^https:\/\//i.test(session.source_page_url || '')) errors.push('source is not an HTTPS official page');
  if (session.start_time && session.end_time && session.end_time <= session.start_time) errors.push('end time is not after start time');
  return errors;
}
