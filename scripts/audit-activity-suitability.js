/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_suitability_archives.generated.sql');
const outputAudit = join(root, 'data', 'activity_suitability_audit.generated.json');

const alwaysUnsuitableTypes = new Set([
  'casino', 'liquor_store', 'wine_bar', 'hookah_bar', 'strip_club',
  'adult_entertainment', 'tobacco_shop', 'gun_shop',
]);

const conditionalAdultVenueTypes = new Set(['bar', 'bar_and_grill', 'night_club']);

const genericNonActivityTypes = new Set([
  'accounting', 'atm', 'bank', 'car_dealer', 'car_rental', 'car_repair', 'cemetery',
  'church', 'college', 'courthouse', 'dentist', 'doctor', 'embassy', 'fire_station',
  'funeral_home', 'gas_station', 'government_office', 'hindu_temple', 'hospital',
  'insurance_agency', 'lawyer', 'library', 'local_government_office', 'lodging',
  'mosque', 'parking', 'police', 'post_office', 'primary_school', 'real_estate_agency',
  'school', 'secondary_school', 'subway_station', 'synagogue', 'train_station',
  'university',
]);

const adultOnlyText = /\b(adults?[- ]only|adult[- ]only|18\+|over[- ]18s?|club night|nightclub|casino|poker night|striptease|burlesque|pole dancing|wine tasting|cocktail masterclass|bottomless brunch|pub quiz|beer festival|craft beer|sports bar|shisha|hookah|vape|tobacco|liquor store)\b/i;
const familySignal = /\b(baby|babies|toddler|toddlers|child|children|kids?|family|families|parent|play|story|rhyme|sensory|swim|museum|park|garden|zoo|farm|bookshop|soft play)\b/i;
const indoorPlayAdultVenue = /\b(arcade|virtual reality|vr gaming|gaming lounge|gaming cafe|escape room|casino)\b/i;

function env() {
  const path = join(root, '.env.local');
  return Object.fromEntries(readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function text(activity) {
  return [activity.activity_name, activity.description, activity.category, activity.google_summary, activity.website]
    .filter(Boolean).join(' ');
}

function sql(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function fetchActivities(config) {
  const rows = [];
  const select = [
    'activity_id', 'activity_name', 'category', 'description', 'website', 'source_name', 'data_source',
    'google_primary_type', 'google_summary', 'public_listing_status', 'archive',
  ].join(',');
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select,
      public_listing_status: 'eq.published',
      archive: 'eq.false',
      order: 'activity_id.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/activities?${params}`, {
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${config.VITE_SUPABASE_ANON_KEY}` },
    });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function assess(activity) {
  const reasons = [];
  const content = text(activity);
  const source = String(activity.source_name || '').trim().toLowerCase();
  const category = String(activity.category || '').trim().toLowerCase();
  const primaryType = String(activity.google_primary_type || '').trim().toLowerCase();

  const hasFamilySignal = familySignal.test(content);
  if (alwaysUnsuitableTypes.has(primaryType)) reasons.push(`Google Places type '${primaryType}' is not child or family suitable`);
  // A pub, bar or club can legitimately host a parent-and-baby session, so
  // only archive it when the listing itself has no child or family signal.
  if (source.startsWith('google places') && conditionalAdultVenueTypes.has(primaryType) && !hasFamilySignal) {
    reasons.push(`Google Places type '${primaryType}' has no child or family activity signal`);
  }
  if (adultOnlyText.test(content) && !hasFamilySignal) {
    reasons.push('Listing text indicates an adult-only or alcohol-led activity');
  }

  // The retired generic importer created venues rather than activities. This
  // rule only applies to its exact source name so specialist venue-based
  // children’s classes remain visible.
  if (source === 'google places api' && genericNonActivityTypes.has(primaryType)) {
    reasons.push(`Generic Google Places '${primaryType}' venue, not a child-focused listing`);
  }
  if (source === 'google places api' && category === 'family activity' && !hasFamilySignal) {
    reasons.push('Generic Google Places venue has no child or family activity signal');
  }
  if (category === 'indoor play' && indoorPlayAdultVenue.test(content)) {
    reasons.push('Indoor play listing is an adult gaming or arcade venue');
  }

  return reasons;
}

function buildSql(candidates) {
  if (!candidates.length) return '-- No high-confidence unsuitable activities found.\n';
  return `-- Generated by scripts/audit-activity-suitability.js
-- Archive only high-confidence adult-only or generic non-activity venues.
-- Other potentially relevant places remain available for editorial review.

update public.activities
set archive = true,
    public_listing_status = 'archived',
    updated_at = now()
where activity_id in (
  ${candidates.map((candidate) => `${sql(candidate.activity_id)}::uuid`).join(',\n  ')}
)
  and coalesce(archive, false) = false
  and public_listing_status = 'published';
`;
}

async function main() {
  const activities = await fetchActivities(env());
  const candidates = activities
    .map((activity) => ({ ...activity, reasons: assess(activity) }))
    .filter((activity) => activity.reasons.length)
    .sort((left, right) => left.activity_name.localeCompare(right.activity_name));
  const reasonCounts = candidates.reduce((counts, activity) => {
    for (const reason of activity.reasons) counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  const audit = {
    generated_at: new Date().toISOString(),
    checked_records: activities.length,
    archived_candidates: candidates.length,
    reasons: reasonCounts,
    candidates: candidates.map(({ activity_id, activity_name, category, source_name, google_primary_type, reasons }) => ({
      activity_id, activity_name, category, source_name, google_primary_type, reasons,
    })),
  };

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(candidates));
  writeFileSync(outputAudit, JSON.stringify(audit, null, 2) + '\n');
  console.log(`Suitability audit checked ${activities.length} active listings and flagged ${candidates.length} high-confidence unsuitable records.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
