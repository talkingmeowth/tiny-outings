# Tiny Outings Update

`tiny-outings-update` runs every supported importer across London, then applies
one quality contract to the combined results. It covers Happity, Waltham Forest
Best Start for Life, Eventbrite, Fever, Loopla, Museums London, Time Out,
Google Places, parks, family cafes, London Family Hubs and supporting enrichment jobs.

Each run attempts a listing website, an independent organiser website for
Happity, Fever, and Eventbrite, and representative images from both pages. It
repairs generic Happity URLs, validates external links, validates Google Place
and Maps locations, resolves missing coordinates, archives confirmed permanently closed places, fills age
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
- The recurring run validates gaps in Google Place coverage. Run
  `node scripts/validate-google-places-records.js --full` separately when a
  deliberately paced complete refresh of stored Place records is required.
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
- Newly added records receive one SerpAPI candidate search after import even
  when an official image was found. The search uses the activity name, its
  postcode-resolved London ward, postcode/borough and category; cafe queries
  ask for interiors, seating and exteriors. The candidate-fetch timestamp
  prevents later runs from repeating the paid search.
- `tiny-outings-update --apply` then prepares the unreviewed candidate sets for
  multimodal Codex review. Deterministic metadata and image checks remove clear
  mismatches, undersized/extreme images and perceptual duplicates, keeping 3-5
  finalists per activity. It creates one labelled strip per activity and one
  compact contact sheet per 10 activities. This applies to every category, with
  category-aware preferences such as cafe interiors/seating/exteriors, park
  overviews and pool views. Codex inspects only these finalists and applies a
  selected raw index or explicit rejection. `activity_image_llm_reviews` records
  the model, workflow version, exact candidate-fetch timestamp, decision and
  reason, so already-reviewed sets are never sent to the model again. Selected
  images are copied to Storage and saved as `scraped_image_url`.
- Run `npm.cmd run activities:images:test-codex-review` before scaling a new
  scoring policy. It processes 10 pending activities without database writes;
  cached thumbnails and sheets make retries resumable and inexpensive.
- The recurring run sends only activities created during that import to
  SerpAPI, then passes only the successfully enriched IDs into contact-sheet
  preparation. It never sweeps the historic database automatically. Manual
  backlog preparation defaults to 10 activities and requires an explicit
  `--limit` to process more.
- Listing pages are requested sequentially with delays to avoid aggressive
  scraping. Check source terms and API billing before increasing limits.
- Historic standalone card, filter, swipe, Happity-location, Better Start
  recurrence, and Google-link repair utilities have been removed. Their active
  safeguards are covered by the recurring importers, shared validation, and
  test suite.
