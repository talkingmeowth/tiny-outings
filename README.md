# Parent Activity Planner

MVP database start for a parent/baby activity planning app covering Waltham Forest first, then Hackney, Islington, and Newham.

## What Is Here

- `supabase/migrations/20260708210000_create_activities.sql` creates the Supabase `public.activities` table.
- `supabase/migrations/20260708213000_create_core_app_tables.sql` creates users, follows, comments, swipes, shortlist, calendar, reviews, and photos.
- `supabase/migrations/20260708220000_allow_activity_submissions.sql` lets signed-in users submit draft activities from the frontend.
- `supabase/seed/activities_waltham_forest.sql` inserts the first Waltham Forest activity data.
- `data/waltham_forest_activities_seed.csv` is a review-friendly copy of the seed.
- `docs/activity-data-sources.md` records the source URLs and geocoding notes.
- `docs/data-model.md` explains how the core app tables fit together.
- `render.yaml` configures a Render Static Site deploy.
- `src/` contains the React frontend.
- `public/manifest.webmanifest` and `public/service-worker.js` make the frontend installable as a mobile web app.

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

## Core App Table Notes

The second migration adds the social and planning model:

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

It also adds row-level security policies so users can manage their own swipes, shortlist, calendar, statuses, reviews, photos, and comments. Public/followers/private visibility is built into activity statuses and calendar events.

## Render Hosting

Render can host this frontend as a Static Site.

Use these Render settings:

- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Node version: Render can auto-detect Node from the project; Node 20+ is suitable.
- Rewrite rule: `/*` to `/index.html`

Set these environment variables in Render:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Do not put the Supabase service-role key in this frontend. The anon key is expected for browser apps.

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

The frontend is designed as a responsive progressive web app for Android and iOS browsers.

- Android users can install it from Chrome using Add to Home screen or Install app.
- iPhone users can install it from Safari using Share > Add to Home Screen.
- Render serves the site over HTTPS, which is required for service workers and installable PWA behavior.
- The app includes mobile-safe viewport settings, iOS safe-area spacing, touch swipe gestures, and a bottom thumb navigation on small screens.
