# Parent Activity Planner

MVP database start for a parent/baby activity planning app covering Waltham Forest first, then Hackney, Islington, and Newham.

## What Is Here

- `supabase/migrations/20260708210000_create_activities.sql` creates the Supabase `public.activities` table.
- `supabase/migrations/20260708213000_create_core_app_tables.sql` creates the original planning, review, and social support tables.
- `supabase/migrations/20260708220000_allow_activity_submissions.sql` lets authenticated users submit draft activities in older builds.
- `supabase/migrations/20260709162000_google_places_activity_enrichment.sql` adds Google Places metadata fields and removes any demo/sample draft rows.
- `supabase/migrations/20260709173000_add_activity_availability.sql` adds date and availability fields for daily, weekly, seasonal, and one-off activities.
- `supabase/migrations/20260709190000_require_username_and_activity_images.sql` adds preferred activity card image fields.
- `supabase/migrations/20260709203000_allow_anonymous_submissions_and_reviews.sql` lets the account-free mobile app submit draft activities, reviews, and photos without Google login.
- `supabase/functions/activity-link-autofill` enriches a pasted link with Google Places data server-side.
- `supabase/seed/activities_waltham_forest.sql` inserts the first Waltham Forest activity data.
- `supabase/seed/activities_east_london_family_places.sql` adds Waltham Forest, Hackney, and Newham family venues, parks, cafes, museums, hubs, and seasonal activities.
- `data/waltham_forest_activities_seed.csv` is a review-friendly copy of the seed.
- `docs/activity-data-sources.md` records the source URLs and geocoding notes.
- `docs/data-model.md` explains how the core app tables fit together.
- `render.yaml` configures Render to publish the Android APK download only.
- `src/` contains the React frontend.
- `public/manifest.webmanifest` and `public/service-worker.js` are used only when running the frontend locally as a web preview.
- `capacitor.config.json` and `android/` package the frontend as a downloadable Android app.
- `docs/android-build.md` explains how to build a test APK.

## Supabase Setup

Run the migration first:

```bash
supabase db push
```

Then run the seed either in the Supabase SQL editor, or with `psql` if you have your database connection string locally:

```bash
psql "$DATABASE_URL" -f supabase/seed/activities_waltham_forest.sql
```

If you are using the Supabase SQL editor instead of the CLI, run files in this order:

1. `supabase/migrations/20260708210000_create_activities.sql`
2. `supabase/seed/activities_waltham_forest.sql`
3. `supabase/migrations/20260708213000_create_core_app_tables.sql`
4. `supabase/migrations/20260708220000_allow_activity_submissions.sql`
5. `supabase/migrations/20260709162000_google_places_activity_enrichment.sql`
6. `supabase/migrations/20260709173000_add_activity_availability.sql`
7. `supabase/migrations/20260709190000_require_username_and_activity_images.sql`
8. `supabase/migrations/20260709203000_allow_anonymous_submissions_and_reviews.sql`
9. `supabase/seed/activities_east_london_family_places.sql`

## Google Places Setup

The mobile app is account-free. It does not use Google login, usernames, followers, or followed-user signals.

The add-activity screen accepts only one link. To make that work, deploy the Edge Function and store your Google Maps key as a Supabase secret:

```bash
supabase secrets set GOOGLE_MAPS_API_KEY=your_google_maps_key
supabase functions deploy activity-link-autofill
```

In Google Cloud, enable Places API (New). The function uses server-side Place Details, Text Search, and Place Photos calls so the API key is not exposed in the mobile app. If Google does not return a photo, the function tries the activity website's Open Graph/Twitter image and stores it for activity cards.

### E10 family-friendly places import

To expand the directory with permanent family-friendly places around E10, enable both **Places API (New)** and **Geocoding API** for the Google Maps key, then run:

    set GOOGLE_MAPS_API_KEY=your_server_side_key
    npm run activities:google-e10

The import geocodes E10, searches a strict 10-mile (16,093 metre) radius, and combines typed Nearby Search requests for cafes, parks, playgrounds, museums, libraries and amusement centres with family-focused Text Search requests. It de-duplicates by Google place ID, excludes permanently closed venues, fetches place details and a representative photo, and writes:

- supabase/seed/activities_google_places_e10_10_miles.generated.sql — reviewable, idempotent database upsert
- data/google-places-e10-10-miles.generated.json — audit file, including the source centre, distance and rank inputs

The generated records use the existing activities fields. Google opening hours populate the normal availability fields and the original hours JSON is kept in google_opening_hours. The script does not request or store Google review text.

## Activity Table Notes

The table includes the requested core fields:

- `activity_id`
- `activity_name`
- `address`
- `lat`
- `long`
- `category`
- `start_time`
- `end_time`
- `google_link`
- `website`
- `child_friendly_score`
- `app_rating`
- `number_of_reviews`
- `age_suitability`

It also includes MVP-supporting fields for filtering and provenance: `borough`, `postcode`, `days_of_week`, `recurrence_rule`, `time_window`, `location`, `source_url`, and search indexes.

Google-enriched activities can also store `google_place_id`, `google_place_uri`, `google_photo_url`, `google_rating`, `google_user_rating_count`, `google_primary_type`, `google_opening_hours`, and `google_summary`. Cards prefer `google_photo_url`, then `image_url`, then a website-derived preview.

Availability is stored with:

- `activity_date` for a single known activity date.
- `available_dates` for explicit date lists.
- `availability_start_date` and `availability_end_date` for date ranges or seasonal listings.
- `available_days_of_week` for recurring weekly or daily venue availability.
- `availability_type` and `availability_notes` for display and data-quality context.

## Core App Table Notes

The second migration still contains the original social and planning tables:

- `user_table`
- `user_follows`
- `comments_table`
- `activity_swipes`
- `activity_shortlist`
- `activity_user_statuses`
- `calendar_events`
- `calendar_event_exports`
- `activity_reviews`
- `activity_photos`

The current mobile app no longer uses accounts, follows, or user-specific Supabase planning writes. Swipes, shortlist, statuses, and calendar choices are stored on the device. Anonymous draft activity submissions, reviews, and photos are enabled by the latest migration.

## Render Hosting

Render is used only as a static download host for the Android APK. It does not publish the React app as a webpage.

Use these Render settings:

- Build command: `npm install && npm run render:download`
- Publish directory: `render-mobile`
- Node version: Render can auto-detect Node from the project; Node 20+ is suitable.

The published APK path is `/downloads/tiny-outings-debug.apk`. The root URL can return a 404 because there is intentionally no app webpage.

## Local Frontend

```bash
npm install
npm run dev
```

If PowerShell blocks `npm`, use `npm.cmd` instead:

```bash
npm.cmd install
npm.cmd run dev
```

## Mobile Support

The frontend is designed to be bundled into the native mobile app with Capacitor.

- Android users can install the APK directly for testing.
- iPhone distribution requires an iOS Capacitor build on a Mac plus TestFlight or the App Store.
- The app includes mobile-safe viewport settings, touch swipe gestures, and bottom navigation.

## Downloadable Android App

Build a test APK with:

```bash
npm run android:apk
```

The APK will be created at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The current Render-hosted test APK is available at:

```text
https://tiny-outings-cpjh.onrender.com/downloads/tiny-outings-debug.apk
```

See `docs/android-build.md` for Android APK, Play Store bundle, and iPhone distribution notes.
