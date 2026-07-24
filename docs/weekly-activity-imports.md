# Weekly Activity Imports

The directory can be refreshed weekly with Happity, Waltham Forest Best Start
in Life, Eventbrite, Fever, local parks, quality cafes and bakeries, and
official Google Places importers. A final image-curation step applies the same
source and image-quality rules used for the live cards. Each importer writes SQL using the activity
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
under `supabase/seed/` and can be inspected before applying. Add
`--skip-image-curation` only when you deliberately need a faster import without
refreshing card images.

## Safety Rules

- The runner stops before applying SQL if a required source fails.
- Waltham Forest Best Start, Eventbrite, and Google Places sources require a configured Google key and are
  skipped rather than guessed.
- Eventbrite inserts use the listing URL as the duplicate key.
- Fever inserts update by listing URL; Google Places inserts update by place ID.
- Google cafe importers consistently exclude adult-led venue types and manually
  reviewed unsuitable family listings.
- Park imports deliberately omit website, organiser, and image-source links;
  cards use their map link and the in-app park illustration instead.
- Happity schedule snapshots preserve their activity-specific image before a
  generic historic venue image.
- Listing pages are requested sequentially with delays to avoid aggressive
  scraping. Check source terms and API billing before increasing limits.
