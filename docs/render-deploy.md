# Render Deployment

Render is used only to host the downloadable Android APK. The React frontend is bundled into the native app with Capacitor and is not published as a webpage.

## Before Deploying

Run these SQL files in Supabase:

1. `supabase/migrations/20260708210000_create_activities.sql`
2. `supabase/seed/activities_waltham_forest.sql`
3. `supabase/migrations/20260708213000_create_core_app_tables.sql`
4. `supabase/migrations/20260708220000_allow_activity_submissions.sql`

## Render Settings

1. Push this project to GitHub or GitLab.
2. Go to https://dashboard.render.com.
3. Choose New > Static Site.
4. Connect the repo.
5. Use these settings:

```text
Build Command: npm install && npm run render:download
Publish Directory: render-mobile
```

6. Do not add a rewrite rule for the React app. The APK is served directly from:

```text
https://tiny-outings-cpjh.onrender.com/downloads/tiny-outings-debug.apk
```

## Notes

- `render.yaml` uses the `render:download` script to copy `release/tiny-outings-debug.apk` into `render-mobile/downloads/`.
- The root Render URL can return 404 because there is intentionally no public app webpage.
- Supabase environment variables are still needed when building/running the app itself, but they are not required for Render's APK download host.
