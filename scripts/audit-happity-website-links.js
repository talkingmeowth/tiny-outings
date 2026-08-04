/* global process */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_happity_website_link_repairs.generated.sql');
const outputAudit = join(root, 'data', 'happity_website_link_audit.generated.json');
const snapshotFiles = [
  'data/happity_waltham_forest_2026.generated.json',
  'data/happity_hackney_islington_newham_2026.generated.json',
  'data/happity_manual_schedules.json',
];

function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function normal(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return new Set(normal(value).split(' ').filter((token) => token.length > 1));
}

function similarity(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / (leftTokens.size + rightTokens.size - overlap || 1);
}

function outwardPostcode(value) {
  return String(value || '').match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/i)?.[1]?.toUpperCase() ||
    String(value || '').match(/\b([A-Z]{1,2}\d{1,2})\b/i)?.[1]?.toUpperCase() || null;
}

function canonicalUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function dayCode(value) {
  const text = normal(value);
  return ({ monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' })[text.replace(/s$/, '')] || null;
}

function startTime(value) {
  const match = String(value || '').match(/(\d{1,2})[:.]?(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

function anchorTiming(value) {
  const fragment = String(value || '').split('#')[1] || '';
  const match = fragment.match(/-(mon|tue|wed|thu|fri|sat|sun)-(\d{3,4})$/i);
  if (!match) return { day: null, start: null };
  const rawTime = match[2].padStart(4, '0');
  return { day: match[1].toLowerCase(), start: `${rawTime.slice(0, 2)}:${rawTime.slice(2)}` };
}

function hasConflictingAgeLabel(activityName, scheduleName) {
  const ageWords = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const activity = normal(activityName);
  const schedule = normal(scheduleName);
  const activityAge = ageWords.find((word) => activity.includes(`under ${word}`));
  const scheduleAge = ageWords.find((word) => schedule.includes(`under ${word}`));
  return Boolean(activityAge && scheduleAge && activityAge !== scheduleAge);
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function schedulesFromSnapshots() {
  const schedules = [];
  for (const file of snapshotFiles) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    for (const row of Array.isArray(parsed) ? parsed : parsed.happity || []) {
      if (!row.detailUrl?.includes('happity.co.uk/schedules/')) continue;
      schedules.push({
        activityName: row.name || '',
        venue: row.venue || '',
        detailUrl: row.detailUrl,
        outwardPostcode: outwardPostcode(row.venue),
        day: dayCode(row.day),
        start: startTime(row.time),
      });
    }
  }
  return schedules;
}

async function loadActivities(env) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/activities?select=activity_id,activity_name,address,website,source_url&source_name=eq.Happity&limit=1000&offset=${offset}`,
      { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } },
    );
    if (!response.ok) throw new Error(`Could not load Happity activities: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function isScheduleLink(url) {
  return canonicalUrl(url).includes('happity.co.uk/schedules/');
}

function bestScheduleMatch(activity, schedules) {
  const activityOutwardPostcode = outwardPostcode(activity.address);
  const timing = anchorTiming(activity.website);
  const candidates = schedules
    .map((schedule) => ({
      schedule,
      nameScore: similarity(activity.activity_name, schedule.activityName),
      venueScore: similarity(activity.address, schedule.venue),
      sameArea: Boolean(activityOutwardPostcode && schedule.outwardPostcode === activityOutwardPostcode),
    }))
    // Never cross-link an activity to a similarly named class in another area.
    .filter((candidate) => candidate.sameArea && !hasConflictingAgeLabel(activity.activity_name, candidate.schedule.activityName))
    .sort((left, right) => (
      (right.nameScore + right.venueScore * 0.25) - (left.nameScore + left.venueScore * 0.25)
    ));
  const timedCandidates = candidates.filter((candidate) => (
    (!timing.day || candidate.schedule.day === timing.day) &&
    (!timing.start || candidate.schedule.start === timing.start)
  ));
  const rankedCandidates = timedCandidates.length ? timedCandidates : candidates;
  const best = rankedCandidates[0];
  if (!best || best.nameScore < 0.55 || (best.nameScore < 0.75 && best.venueScore < 0.3)) return null;

  const nearEqual = rankedCandidates.filter((candidate) => (
    candidate.nameScore >= best.nameScore - 0.03 &&
    candidate.venueScore >= best.venueScore - 0.03
  ));
  const uniqueUrls = [...new Set(nearEqual.map((candidate) => canonicalUrl(candidate.schedule.detailUrl)))];

  // Multiple weekly occurrences may be present. Prefer the shortest canonical
  // schedule URL if those occurrences all describe the same activity and venue.
  const selectedUrl = uniqueUrls.sort((left, right) => left.length - right.length)[0];
  return { ...best, detailUrl: selectedUrl, candidateCount: uniqueUrls.length };
}

async function main() {
  const env = readEnv();
  const schedules = schedulesFromSnapshots();
  const snapshotUrls = new Set(schedules.map((schedule) => canonicalUrl(schedule.detailUrl)));
  const activities = await loadActivities(env);
  const alreadyVerified = activities.filter((activity) => snapshotUrls.has(canonicalUrl(activity.website)));
  const directoryAnchors = activities.filter((activity) => (
    String(activity.website || '').includes('happity.co.uk/') && !isScheduleLink(activity.website)
  ));
  const officialLinks = activities.filter((activity) => activity.website && !String(activity.website).includes('happity.co.uk/'));
  const repairs = [];
  const manualReview = [];

  for (const activity of directoryAnchors) {
    const match = bestScheduleMatch(activity, schedules);
    if (!match) {
      manualReview.push({ activity_id: activity.activity_id, activity_name: activity.activity_name, address: activity.address, current_url: activity.website, reason: 'No unique same-area schedule match in snapshot.' });
      continue;
    }
    repairs.push({
      activity_id: activity.activity_id,
      activity_name: activity.activity_name,
      old_url: activity.website,
      new_url: match.detailUrl,
      name_score: Number(match.nameScore.toFixed(3)),
      venue_score: Number(match.venueScore.toFixed(3)),
      candidate_urls: match.candidateCount,
    });
  }

  const sqlText = repairs.length
    ? `-- Generated by scripts/audit-happity-website-links.js\n-- Replaces only validated Happity directory anchors with an individual schedule page.\nwith website_repairs (activity_id, website) as (\n  values\n    ${repairs.map((repair) => `(${sql(repair.activity_id)}::uuid, ${sql(repair.new_url)}::text)`).join(',\n    ')}\n)\nupdate public.activities as activity\nset website = website_repairs.website, updated_at = now()\nfrom website_repairs\nwhere activity.activity_id = website_repairs.activity_id;\n`
    : '-- No validated Happity website link repairs were found.\n';

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, sqlText);
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_happity_records: activities.length,
    snapshot_schedule_urls: snapshotUrls.size,
    already_verified_schedule_links: alreadyVerified.length,
    directory_anchor_links: directoryAnchors.length,
    official_organiser_links: officialLinks.length,
    repaired_links: repairs.length,
    needs_manual_review: manualReview.length,
    repairs,
    manual_review: manualReview,
  }, null, 2) + '\n');
  console.log(`Happity links: ${alreadyVerified.length} verified; ${repairs.length} repaired; ${manualReview.length} require manual review.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
