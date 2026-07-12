# Weekly Activity Imports

The directory can be refreshed weekly with the existing Eventbrite, Fever, and
official Google Places importers. Each importer writes SQL using the activity
table's existing conflict keys, so a repeated run only adds new source URLs or
updates an existing Google Place/Fever listing. Listings without a verified
latitude and longitude stay out of the published directory, preserving accurate
distance and travel filtering.

## Run Locally

Set the database connection URL and, for Google Places, a server-side Google
Maps key. Do not put either value in a committed file.

```powershell
$env:DATABASE_URL = 'postgresql://...'
$env:GOOGLE_MAPS_API_KEY = '...'
npm.cmd run activities:weekly:apply
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are also required by the
Eventbrite deduplication step. The script reads them from `.env.local` if they
are not already set in the shell.

To discover listings and produce reviewable SQL without changing the database:

```powershell
npm.cmd run activities:weekly
```

Every run writes `data/weekly-imports/YYYY-MM-DD.json`. Generated SQL remains
under `supabase/seed/` and can be inspected before applying.

## Scheduled GitHub Run

The workflow at `.github/workflows/weekly-activity-import.yml` runs every
Monday at 06:15 UTC and can also be started from the **Actions** tab with
**Run workflow**.

Create these repository secrets in GitHub at **Settings > Secrets and variables
> Actions**:

- `SUPABASE_URL`: your project URL.
- `SUPABASE_ANON_KEY`: your public/anon key, used only to read existing source
  URLs for deduplication.
- `SUPABASE_DB_URL`: a Supabase Postgres connection string with permission to
  insert into `public.activities`.
- `GOOGLE_MAPS_API_KEY`: a restricted server-side key with Places API (New) and
  Geocoding API enabled.

The workflow uploads an audit and the generated SQL as an Actions artifact. It
does not deploy a new APK: the mobile app reads the activities table directly,
so newly imported records become available as soon as the SQL completes.

## Safety Rules

- The runner stops before applying SQL if a required source fails.
- Eventbrite and Google Places sources require a configured Google key and are
  skipped rather than guessed.
- Eventbrite inserts use the listing URL as the duplicate key.
- Fever inserts update by listing URL; Google Places inserts update by place ID.
- Listing pages are requested sequentially with delays to avoid aggressive
  scraping. Check source terms and API billing before increasing limits.
