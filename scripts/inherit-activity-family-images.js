/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activityImageFamilyKey, activityImageLocationKey } from '../src/activityDuplicates.js';
import { isModelImageApproved } from '../src/activityImages.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultSqlPath = join(root, 'supabase', 'seed', 'activity_family_image_inheritance.generated.sql');
const defaultAuditPath = join(root, 'data', 'activity_family_image_inheritance.generated.json');
const imageFields = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'user_image_url',
  'user_uploaded_image_url',
  'model_selected_url',
];

function clean(value) {
  return String(value || '').trim();
}

function usableUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(clean(value)).protocol);
  } catch {
    return false;
  }
}

function approvedDisplayedImage(activity, field, url) {
  return Boolean(activity.image_review_approved_at)
    && clean(activity.image_review_approved_source_field) === field
    && clean(activity.image_review_approved_url).replace(/^http:\/\//i, 'https://') === url.replace(/^http:\/\//i, 'https://');
}

function activityCandidate(activity) {
  for (let priority = 0; priority < imageFields.length; priority += 1) {
    const field = imageFields[priority];
    if (field === 'reviewed_image_url' && activity.use_category_image) continue;
    const url = clean(activity[field]).replace(/^http:\/\//i, 'https://');
    if (!usableUrl(url)) continue;
    // Do not turn one low-confidence local model choice into a supposedly
    // certain cover for a whole provider family. Approved or coverage-safe
    // model choices remain excellent donors for verified same-activity groups.
    if (field === 'model_selected_url' && !isModelImageApproved(activity, url)) continue;
    const approved = approvedDisplayedImage(activity, field, url);
    return {
      activity,
      field,
      url,
      priority: approved && field === 'model_selected_url' ? 3.5 : priority,
      approved,
    };
  }
  return null;
}

function preferredCandidate(candidate, current) {
  if (!current) return candidate;
  if (candidate.priority !== current.priority) return candidate.priority < current.priority ? candidate : current;
  if (candidate.field === 'model_selected_url' && current.field === 'model_selected_url') {
    const candidateConfidence = Number(candidate.activity.model_selected_confidence);
    const currentConfidence = Number(current.activity.model_selected_confidence);
    if (Number.isFinite(candidateConfidence) && Number.isFinite(currentConfidence)
      && candidateConfidence !== currentConfidence) return candidateConfidence > currentConfidence ? candidate : current;
  }
  if (candidate.approved !== current.approved) return candidate.approved ? candidate : current;
  const candidateUpdated = Date.parse(candidate.activity.updated_at || candidate.activity.created_at || 0) || 0;
  const currentUpdated = Date.parse(current.activity.updated_at || current.activity.created_at || 0) || 0;
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated ? candidate : current;
  return String(candidate.activity.activity_id) < String(current.activity.activity_id) ? candidate : current;
}

function isHumanProtected(activity) {
  return Boolean(
    clean(activity.admin_cover_image_url)
    || clean(activity.reviewed_image_url)
    || clean(activity.user_image_url)
    || clean(activity.user_uploaded_image_url)
    || activity.use_category_image
    || activity.image_review_approved_at,
  );
}

export function buildFamilyImageInheritances(activities, options = {}) {
  const createdAfter = options.createdAfter ? Date.parse(options.createdAfter) : null;
  const requestedFamily = clean(options.family);
  const groups = new Map();

  for (const activity of activities || []) {
    const familyKey = activityImageFamilyKey(activity);
    if (!familyKey || (requestedFamily && familyKey !== requestedFamily)) continue;
    const group = groups.get(familyKey) || { activities: [], locations: new Set(), candidate: null };
    group.activities.push(activity);
    group.locations.add(activityImageLocationKey(activity));
    const candidate = activityCandidate(activity);
    if (candidate) group.candidate = preferredCandidate(candidate, group.candidate);
    groups.set(familyKey, group);
  }

  const updates = [];
  const familySummaries = [];
  for (const [familyKey, group] of groups) {
    if (group.locations.size < 2 || !group.candidate) continue;
    const donor = group.candidate;
    let updated = 0;
    for (const activity of group.activities) {
      if (createdAfter != null && (Date.parse(activity.created_at || 0) || 0) < createdAfter) continue;
      if (isHumanProtected(activity)) continue;
      if (clean(activity.model_selected_url).replace(/^http:\/\//i, 'https://') === donor.url
        && clean(activity.model_selected_model) === 'activity-family-inheritance') continue;
      updates.push({
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        family_key: familyKey,
        donor_activity_id: donor.activity.activity_id,
        donor_activity_name: donor.activity.activity_name,
        donor_field: donor.field,
        image_url: donor.url,
        source_url: clean(donor.activity.model_selected_source_url)
          || clean(donor.activity.reviewed_image_source_url)
          || clean(donor.activity.organiser_website)
          || clean(donor.activity.website)
          || donor.url,
      });
      updated += 1;
    }
    familySummaries.push({
      family_key: familyKey,
      listings: group.activities.length,
      locations: group.locations.size,
      donor_activity_id: donor.activity.activity_id,
      donor_activity_name: donor.activity.activity_name,
      donor_field: donor.field,
      image_url: donor.url,
      updates: updated,
    });
  }
  return { updates, families: familySummaries };
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function familyInheritanceSql(result) {
  if (!result.updates.length) return '-- No verified cross-location activity-family image updates were required.\n';
  const statements = result.updates.map((update) => `update public.activities
set model_selected_url = ${sqlLiteral(update.image_url)},
    model_selected_confidence = 1,
    model_selected_at = now(),
    model_selected_original_url = ${sqlLiteral(update.image_url)},
    model_selected_source_url = ${sqlLiteral(update.source_url)},
    model_selected_source_field = ${sqlLiteral(`activity_family:${update.donor_field}`)},
    model_selected_reason = ${sqlLiteral(`Inherited the established cover from ${update.donor_activity_name}; verified same provider and activity family across locations.`)},
    model_selected_model = 'activity-family-inheritance',
    model_selected_model_version = 'family-image-v1',
    updated_at = now()
where activity_id = ${sqlLiteral(update.activity_id)}::uuid
  and coalesce(archive, false) = false
  and public_listing_status in ('draft', 'published')
  and nullif(trim(admin_cover_image_url), '') is null
  and nullif(trim(reviewed_image_url), '') is null
  and nullif(trim(user_image_url), '') is null
  and coalesce(use_category_image, false) = false
  and image_review_approved_at is null
  and not exists (
    select 1 from public.activity_photos photo
    where photo.activity_id = activities.activity_id
      and photo.source_provider = 'user_upload'
      and nullif(trim(photo.photo_url), '') is not null
  );`);
  return `begin;\n\n${statements.join('\n\n')}\n\ncommit;\n`;
}

function linkedActivities() {
  const statement = `select
    a.activity_id, a.activity_name, a.address, a.postcode, a.borough, a.google_place_id,
    a.organiser_website, a.website, a.source_url, a.created_at, a.updated_at,
    a.admin_cover_image_url, a.reviewed_image_url, a.reviewed_image_source_url,
    a.user_image_url, a.model_selected_url, a.model_selected_source_url,
    a.model_selected_model, a.use_category_image, a.image_review_approved_at,
    a.image_review_approved_url, a.image_review_approved_source_field,
    coalesce((select p.photo_url from public.activity_photos p
      where p.activity_id = a.activity_id and p.source_provider = 'user_upload'
        and nullif(trim(p.photo_url), '') is not null
      order by p.created_at desc limit 1), '') as user_uploaded_image_url
  from public.activities a
  where coalesce(a.archive, false) = false
    and a.public_listing_status in ('draft', 'published')
  order by a.activity_id;`;
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const compactStatement = statement.replace(/\s+/g, ' ').trim().replaceAll('"', '\\"');
  const output = execSync(`${executable} supabase db query --linked --output-format json "${compactStatement}"`, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The linked database returned no JSON payload.');
  const payload = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(payload.rows)) throw new Error('The linked database returned no activity rows.');
  return payload.rows;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

export function run() {
  if (!process.argv.includes('--linked-database')) throw new Error('Use --linked-database to read the current activity families.');
  const createdAfter = argument('--created-after');
  if (createdAfter && !Number.isFinite(Date.parse(createdAfter))) throw new Error('--created-after must be an ISO date-time.');
  const family = argument('--family');
  const sqlPath = resolve(argument('--output') || defaultSqlPath);
  const auditPath = resolve(argument('--audit-output') || defaultAuditPath);
  const activities = linkedActivities();
  const result = buildFamilyImageInheritances(activities, { createdAfter, family });
  mkdirSync(dirname(sqlPath), { recursive: true });
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(sqlPath, familyInheritanceSql(result));
  writeFileSync(auditPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    created_after: createdAfter || null,
    requested_family: family || null,
    scanned: activities.length,
    matched_families: result.families.length,
    updates: result.updates.length,
    families: result.families,
    listings: result.updates,
  }, null, 2)}\n`);
  console.log(`Verified activity families: ${result.families.length}; image inheritances: ${result.updates.length}.`);
  console.log(`SQL: ${sqlPath}`);
  console.log(`Audit: ${auditPath}`);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
