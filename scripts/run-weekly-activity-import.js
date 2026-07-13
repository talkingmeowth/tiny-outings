/* global process */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runDate = process.env.ACTIVITY_IMPORT_RUN_DATE || new Date().toISOString().slice(0, 10);
const applyChanges = process.argv.includes('--apply');
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
];

function printHelp() {
  console.log(`Usage: node scripts/run-weekly-activity-import.js [--apply]

Runs the Eventbrite, Fever, and Google Places discovery scripts and writes an
audit report under data/weekly-imports. With --apply, the generated idempotent
SQL is applied to DATABASE_URL using psql.

Required for --apply:
  DATABASE_URL                 Supabase Postgres connection string

Required for Google Places:
  GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY

The Eventbrite importer reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
from the environment or .env.local to avoid re-importing existing source URLs.
Only listings with a verified coordinate are published, preserving reliable
distance and travel calculations in the mobile app.`);
}

function runSource(source) {
  if (source.requiresGoogleKey && !(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY)) {
    return { name: source.name, status: 'skipped', reason: 'Google Places API key is not configured.' };
  }

  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [join(root, 'scripts', source.script)], {
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

function hasInsertRows(filePath) {
  if (!existsSync(filePath)) return false;
  return /\bvalues\s*\r?\n\s*\(/i.test(readFileSync(filePath, 'utf8'));
}

function applySql(filePath) {
  const result = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', '--dbname', process.env.DATABASE_URL, '--file', filePath], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Could not apply ${filePath}: ${(result.stderr || result.stdout || 'psql failed').trim()}`);
  }
}

if (helpRequested) {
  printHelp();
  process.exit(0);
}

const results = sources.map(runSource);
const failed = results.filter((result) => result.status === 'failed');

if (applyChanges && !process.env.DATABASE_URL) {
  failed.push({ name: 'database', status: 'failed', reason: 'DATABASE_URL is required when using --apply.' });
}

if (applyChanges && failed.length === 0) {
  for (const source of sources) {
    const result = results.find((item) => item.name === source.name);
    if (result?.status !== 'generated' || !hasInsertRows(source.output)) continue;
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
