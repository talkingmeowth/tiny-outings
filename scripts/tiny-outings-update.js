/* global process */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runDate = process.env.ACTIVITY_IMPORT_RUN_DATE || new Date().toISOString().slice(0, 10);
const applyChanges = process.argv.includes('--apply');
const applyOnly = process.argv.includes('--apply-only');
const skipImages = process.argv.includes('--skip-images');
const helpRequested = process.argv.includes('--help') || process.argv.includes('-h');
const googleJobCooldownMs = Math.max(0, Number.parseInt(process.env.GOOGLE_PLACES_JOB_COOLDOWN_MS || '65000', 10) || 0);
const outputDirectory = join(root, 'data', 'tiny-outings-update');
const auditPath = join(outputDirectory, `${runDate}.json`);

function readDotEnv(name) {
  try {
    return Object.fromEntries(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')
      .split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch {
    return {};
  }
}

const localEnv = readDotEnv('.env.local');
const googleApiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY
  || localEnv.GOOGLE_PLACES_API_KEY || localEnv.GOOGLE_MAPS_API_KEY || localEnv.VITE_GOOGLE_MAPS_API_KEY;

// Sources run first, followed by common enrichment and validation. Every
// generated SQL file is idempotent: new source URLs insert, familiar ones
// update in place, and database triggers preserve a human archive decision.
const jobs = [
  { name: 'happity', script: 'import-happity-schedules.js', output: 'supabase/seed/activities_happity_schedules.generated.sql' },
  { name: 'better-start-for-life', script: 'import-waltham-forest-best-start.js', output: 'supabase/seed/activities_waltham_forest_best_start_live.generated.sql', google: true },
  { name: 'eventbrite', script: 'import-eventbrite-baby-london.js', output: 'supabase/seed/activities_eventbrite_london_baby_20260711.generated.sql', google: true },
  { name: 'fever', script: 'import-fever-london-family.js', output: 'supabase/seed/activities_fever_london_family_20260711.generated.sql' },
  { name: 'fever-availability', script: 'enrich-fever-availability.js', output: 'supabase/seed/fever_availability_updates.generated.sql' },
  { name: 'loopla', script: 'import-loopla-london.js', output: 'supabase/seed/activities_loopla_london.generated.sql' },
  { name: 'museums-london', script: 'import-museums-london.js', output: 'supabase/seed/activities_museums_london.generated.sql' },
  { name: 'time-out-london-kids', script: 'import-timeout-london-kids.js', output: 'supabase/seed/activities_timeout_london_kids.generated.sql' },
  { name: 'google-places-london', script: 'build-google-places-e10.js', output: 'supabase/seed/activities_google_places_e10_10_miles.generated.sql', google: true },
  { name: 'google-places-family', script: 'import-google-places-family.js', output: 'supabase/seed/activities_google_places_family.generated.sql', google: true },
  { name: 'london-parks', script: 'build-london-parks.js', output: 'supabase/seed/activities_london_parks_20260711.generated.sql', google: true },
  { name: 'family-cafes-and-bakeries', script: 'build-high-rated-family-cafes.js', output: 'supabase/seed/activities_high_rated_family_cafes_20260711.generated.sql', google: true },
  { name: 'repair-generic-happity-links', script: 'repair-generic-happity-links.js', output: 'supabase/seed/activity_generic_happity_link_repairs.generated.sql' },
  { name: 'verify-happity-listing-links', script: 'audit-happity-website-links.js', output: 'supabase/seed/activity_happity_website_link_repairs.generated.sql' },
  { name: 'provider-websites', script: 'enrich-activity-provider-links.js', output: 'supabase/seed/activity_provider_link_updates.generated.sql' },
  { name: 'activity-images', script: 'enrich-activity-images.js', args: ['--missing-only'], output: 'supabase/seed/activity_image_updates.generated.sql', optional: 'images' },
  { name: 'validate-google-places', script: 'validate-google-places-records.js', args: ['--full'], output: 'supabase/seed/activity_google_places_validation.generated.sql', google: true },
  { name: 'audit-websites', script: 'audit-activity-websites.js', output: 'supabase/seed/activity_link_repairs.generated.sql' },
  { name: 'data-quality', script: 'apply-activity-data-quality.js', output: 'supabase/seed/activity_import_quality_updates.generated.sql' },
  { name: 'cross-source-deduplication', script: 'audit-cross-source-duplicates.js', output: 'supabase/seed/activity_cross_source_duplicate_consolidation.generated.sql' },
  { name: 'archive-expired', script: 'archive-expired-activities.js', output: 'supabase/seed/activity_expired_listing_archives.generated.sql' },
];

// This job writes image files through a service-role Edge Function, so it
// must run after generated SQL has been applied to the linked project.
const postApplyJobs = [
  {
    name: 'download-website-images',
    script: 'download-activity-website-images.js',
    output: 'data/activity_website_image_downloads.generated.json',
    optional: 'images',
  },
];

function printHelp() {
  console.log(`Usage: npm run tiny-outings-update -- [--apply] [--apply-only] [--skip-images]

Runs every supported Tiny Outings importer across London and then applies the
same shared quality contract to all results:
  - source and organiser website discovery, direct Happity listing repair, and link health checks
  - website and organiser image extraction using the shared image-quality policy
  - durable download of missing official website images into Supabase Storage
  - Google Places identity, Maps location, canonical link, and permanent-closure validation
  - age suitability and "Any time" completion for unknown availability
  - existing-record updates, cross-source duplicate consolidation, and expiry archiving

Google Places validation is mandatory. The job fails if GOOGLE_MAPS_API_KEY or
GOOGLE_PLACES_API_KEY is unavailable; it never silently publishes unchecked
records. Existing archives are protected by the database trigger.

With --apply, SQL is applied to DATABASE_URL with psql or the linked Supabase
project with the Supabase CLI. --apply-only reuses the latest generated SQL
without contacting source websites or Google Places again.`);
}

function runJob(job) {
  if (job.optional === 'images' && skipImages) {
    return { name: job.name, status: 'skipped', reason: 'Skipped with --skip-images.' };
  }
  if (job.google && !googleApiKey) {
    return { name: job.name, status: 'failed', reason: 'GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY is required for this mandatory validation step.' };
  }

  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [join(root, 'scripts', job.script), ...(job.args || [])], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || googleApiKey,
      GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY || googleApiKey,
      ACTIVITY_IMPORT_RUN_DATE: runDate,
    },
  });
  const succeeded = result.status === 0;
  return {
    name: job.name,
    status: succeeded ? 'generated' : 'failed',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    output: join(root, job.output),
    message: (succeeded ? result.stdout : result.stderr || result.stdout || `Exited with code ${result.status}`).trim(),
  };
}

function waitSynchronously(milliseconds) {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function hasDatabaseChanges(filePath) {
  return existsSync(filePath) && /\b(?:insert|update|delete)\s+(?:into\s+)?public\.activities\b/i.test(readFileSync(filePath, 'utf8'));
}

function applySql(filePath) {
  const usePsql = Boolean(process.env.DATABASE_URL);
  const command = usePsql ? 'psql' : 'npx';
  const args = usePsql
    ? ['--set', 'ON_ERROR_STOP=1', '--dbname', process.env.DATABASE_URL, '--file', filePath]
    : ['supabase', 'db', 'query', '--linked', '--file', filePath];
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    shell: !usePsql && process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Could not apply ${filePath}: ${(result.error?.message || result.stderr || result.stdout || 'database command failed').trim()}`);
  }
}

if (helpRequested) {
  printHelp();
  process.exit(0);
}

const results = [];
if (applyOnly) {
  for (const job of jobs) {
    const output = join(root, job.output);
    results.push(existsSync(output)
      ? { name: job.name, status: 'generated', output, message: 'Using latest generated SQL without re-importing.' }
      : { name: job.name, status: 'failed', output, reason: 'Generated SQL is missing; run the full update first.' });
  }
} else {
  let lastGoogleJobFinishedAt = 0;
  for (const job of jobs) {
    if (job.google && lastGoogleJobFinishedAt) {
      waitSynchronously(Math.max(0, googleJobCooldownMs - (Date.now() - lastGoogleJobFinishedAt)));
    }
    const result = runJob(job);
    results.push(result);
    if (job.google) lastGoogleJobFinishedAt = Date.now();
  }
}
const failed = results.filter((result) => result.status === 'failed');

if (applyChanges && failed.length === 0) {
  for (const job of jobs) {
    const result = results.find((item) => item.name === job.name);
    if (result?.status !== 'generated' || !hasDatabaseChanges(result.output)) continue;
    try {
      applySql(result.output);
      result.applied = true;
    } catch (error) {
      result.status = 'failed';
      result.reason = error.message;
      failed.push(result);
      break;
    }
  }

  if (failed.length === 0) {
    for (const job of postApplyJobs) {
      if (job.optional === 'images' && skipImages) {
        results.push({ name: job.name, status: 'skipped', reason: 'Skipped with --skip-images.' });
        continue;
      }
      const result = runJob(job);
      results.push(result);
      if (result.status === 'failed') {
        failed.push(result);
        break;
      }
    }
  }
} else if (!applyChanges) {
  for (const job of postApplyJobs) {
    results.push({
      name: job.name,
      status: 'skipped',
      reason: 'Runs after --apply because it writes stable image files to Supabase Storage.',
    });
  }
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(auditPath, JSON.stringify({
  job: 'tiny-outings-update',
  run_date: runDate,
  generated_at: new Date().toISOString(),
  applied_to_database: applyChanges && failed.length === 0,
  google_places_validation: 'required',
  manual_review: 'not required for importer records',
  archive_protection: 'database trigger preserves archive=true and archived status',
  downloaded_website_images: 'post-apply Edge Function stores vetted images from organiser and listing websites',
  jobs: results,
}, null, 2) + '\n');

for (const result of results) {
  console.log(`${result.name}: ${result.status}${result.message ? ` - ${result.message}` : result.reason ? ` - ${result.reason}` : ''}`);
}
console.log(`Tiny Outings update audit: ${auditPath}`);
if (failed.length) process.exit(1);
