/* global process */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runDate = process.env.ACTIVITY_IMPORT_RUN_DATE || new Date().toISOString().slice(0, 10);
const applyChanges = process.argv.includes('--apply');
const skipImageCuration = process.argv.includes('--skip-image-curation');
const helpRequested = process.argv.includes('--help') || process.argv.includes('-h');
const outputDirectory = join(root, 'data', 'weekly-imports');
const auditPath = join(outputDirectory, `${runDate}.json`);

const sources = [
  {
    name: 'happity',
    script: 'import-happity-schedules.js',
    output: join(root, 'supabase', 'seed', 'activities_happity_schedules.generated.sql'),
  },
  {
    name: 'waltham-forest-best-start',
    script: 'import-waltham-forest-best-start.js',
    output: join(root, 'supabase', 'seed', 'activities_waltham_forest_best_start_live.generated.sql'),
    requiresGoogleKey: true,
  },
  {
    name: 'eventbrite',
    script: 'import-eventbrite-baby-london.js',
    output: join(root, 'supabase', 'seed', 'activities_eventbrite_london_baby_20260711.generated.sql'),
    requiresGoogleKey: true,
  },
  {
    name: 'fever',
    script: 'import-fever-london-family.js',
    output: join(root, 'supabase', 'seed', 'activities_fever_london_family_20260711.generated.sql'),
  },
  {
    name: 'fever-availability',
    script: 'enrich-fever-availability.js',
    output: join(root, 'supabase', 'seed', 'fever_availability_updates.generated.sql'),
  },
  {
    name: 'loopla',
    script: 'import-loopla-london.js',
    output: join(root, 'supabase', 'seed', 'activities_loopla_london.generated.sql'),
  },
  {
    name: 'museums-london',
    script: 'import-museums-london.js',
    output: join(root, 'supabase', 'seed', 'activities_museums_london.generated.sql'),
  },
  {
    name: 'time-out-london-kids',
    script: 'import-timeout-london-kids.js',
    output: join(root, 'supabase', 'seed', 'activities_timeout_london_kids.generated.sql'),
  },
  {
    name: 'google-places',
    script: 'build-google-places-e10.js',
    output: join(root, 'supabase', 'seed', 'activities_google_places_e10_10_miles.generated.sql'),
    requiresGoogleKey: true,
  },
  {
    name: 'local-parks',
    script: 'build-london-parks.js',
    output: join(root, 'supabase', 'seed', 'activities_london_parks_20260711.generated.sql'),
    requiresGoogleKey: true,
  },
  {
    name: 'quality-cafes-and-bakeries',
    script: 'build-high-rated-family-cafes.js',
    output: join(root, 'supabase', 'seed', 'activities_high_rated_family_cafes_20260711.generated.sql'),
    requiresGoogleKey: true,
  },
  {
    name: 'image-curation',
    script: 'enrich-activity-images.js',
    args: ['--audit'],
    output: join(root, 'supabase', 'seed', 'activity_image_updates.generated.sql'),
  },
  {
    name: 'data-quality',
    script: 'apply-activity-data-quality.js',
    output: join(root, 'supabase', 'seed', 'activity_import_quality_updates.generated.sql'),
  },
  {
    name: 'archive-expired',
    script: 'archive-expired-activities.js',
    output: join(root, 'supabase', 'seed', 'activity_expired_listing_archives.generated.sql'),
  },
];

function printHelp() {
  console.log(`Usage: node scripts/run-weekly-activity-import.js [--apply] [--skip-image-curation]

Runs the directory importers followed by image curation and writes an audit
report under data/weekly-imports. With --apply, generated idempotent SQL is
applied using DATABASE_URL and psql, or the linked Supabase project.

Required for --apply (one of):
  DATABASE_URL                 Supabase Postgres connection string (uses psql)
  SUPABASE_ACCESS_TOKEN        Uses the linked Supabase project (uses Supabase CLI)

Required for Google Places:
  GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY

The Eventbrite importer reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
from the environment or .env.local to avoid re-importing existing source URLs.
Only listings with a verified coordinate are published, preserving reliable
distance and travel calculations in the mobile app.`);
}

function runSource(source) {
  if (source.name === 'image-curation' && skipImageCuration) {
    return { name: source.name, status: 'skipped', reason: 'Skipped with --skip-image-curation.' };
  }
  if (source.requiresGoogleKey && !(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY)) {
    return { name: source.name, status: 'skipped', reason: 'Skipped: this source requires Google services, which are disabled.' };
  }

  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [join(root, 'scripts', source.script), ...(source.args || [])], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ACTIVITY_IMPORT_RUN_DATE: runDate },
  });
  const succeeded = result.status === 0;

  return {
    name: source.name,
    status: succeeded ? 'generated' : 'failed',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    output: source.output,
    message: (succeeded ? result.stdout : result.stderr || result.stdout || `Exited with code ${result.status}`).trim(),
  };
}

function hasDatabaseChanges(filePath) {
  if (!existsSync(filePath)) return false;
  return /\b(?:insert|update|delete)\s+(?:into\s+)?public\.activities\b/i.test(readFileSync(filePath, 'utf8'));
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
    // npx is a .cmd shim on Windows; running it through the shell avoids the
    // Windows EINVAL error while the file paths remain runner-controlled.
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

const results = sources.map(runSource);
const failed = results.filter((result) => result.status === 'failed');

if (applyChanges && !process.env.DATABASE_URL && !process.env.SUPABASE_ACCESS_TOKEN) {
  failed.push({ name: 'database', status: 'failed', reason: 'DATABASE_URL or SUPABASE_ACCESS_TOKEN is required when using --apply.' });
}

if (applyChanges && failed.length === 0) {
  for (const source of sources) {
    const result = results.find((item) => item.name === source.name);
    if (result?.status !== 'generated' || !hasDatabaseChanges(source.output)) continue;
    try {
      applySql(source.output);
      result.applied = true;
    } catch (error) {
      result.status = 'failed';
      result.reason = error.message;
      failed.push(result);
      break;
    }
  }
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(auditPath, JSON.stringify({
  run_date: runDate,
  generated_at: new Date().toISOString(),
  applied_to_database: applyChanges && failed.length === 0,
  sources: results,
}, null, 2) + '\n');

for (const result of results) {
  console.log(`${result.name}: ${result.status}${result.message ? ` - ${result.message}` : result.reason ? ` - ${result.reason}` : ''}`);
}
console.log(`Weekly import audit: ${auditPath}`);

if (failed.length) process.exit(1);
