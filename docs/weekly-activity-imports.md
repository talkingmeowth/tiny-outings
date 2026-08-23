# Tiny Outings Update

`tiny-outings-update` runs every supported importer across London, then applies
one quality contract to the combined results. It covers Happity, Waltham Forest
Best Start for Life, Eventbrite, Fever, Loopla, Museums London, Time Out,
Google Places, parks, family cafes, London Family Hubs and supporting enrichment jobs.

Each run attempts a listing website, an independent organiser website for
Happity, Fever, and Eventbrite, and representative images from both pages. It
repairs generic Happity URLs, validates external links, validates Google Place
and Maps locations, archives confirmed permanently closed places, fills age
guidance, and records unknown times as `Any time`. Existing source URLs update
in place; cross-source duplicates are consolidated. Human archives are never
revived by an importer refresh.

## Run Locally

Set the database connection URL and, for Google Places, a server-side Google
Maps key. Do not put either value in a committed file.

```powershell
$env:DATABASE_URL = 'postgresql://...'
$env:GOOGLE_MAPS_API_KEY = '...'
npm.cmd run tiny-outings-update:apply
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are also required by the
Eventbrite deduplication step. The script reads them from `.env.local` if they
are not already set in the shell.

To discover listings and produce reviewable SQL without changing the database:

```powershell
npm.cmd run tiny-outings-update
```

Every run writes `data/tiny-outings-update/YYYY-MM-DD.json`. Generated SQL
remains under `supabase/seed/` and can be inspected before applying. Each job
must refresh its expected output file; a stale file stops an apply. Add
`--skip-images` only when you deliberately need a faster run without refreshing
website images.

## Safety Rules

- The job stops before applying SQL if a required source or Google validation fails.
- Google Places validation is mandatory and requires a configured server-side key.
- Eventbrite, Fever, Loopla, Happity, and Google Places use source-specific
  conflict keys to update a known listing instead of creating a duplicate.
- New importer records and community submissions remain drafts in the admin
  review queue. Existing published records receive only safe enrichment updates.
- The pipeline is manual only. No GitHub Actions workflow runs importers.
- A database trigger keeps `archive = true` and `public_listing_status = archived`
  unchanged when an importer sends a later UPSERT.
- Google cafe importers consistently exclude adult-led venue types and manually
  reviewed unsuitable family listings.
- Park imports omit generic council links, but the shared Google validation and
  image jobs can enrich a specific official page when one is available.
- Happity schedule snapshots preserve their activity-specific image before a
  generic historic venue image.
- Listing pages are requested sequentially with delays to avoid aggressive
  scraping. Check source terms and API billing before increasing limits.
