# Render Deployment

This frontend is a Vite React app and should be deployed to Render as a Static Site.

## Before Deploying

Run these SQL files in Supabase:

1. `supabase/migrations/20260708210000_create_activities.sql`
2. `supabase/seed/activities_waltham_forest.sql`
3. `supabase/migrations/20260708213000_create_core_app_tables.sql`
4. `supabase/migrations/20260708220000_allow_activity_submissions.sql`

In Supabase, copy these values from Project Settings:

- Project URL
- Anon public key

## Render Settings

1. Push this project to GitHub or GitLab.
2. Go to https://dashboard.render.com.
3. Choose New > Static Site.
4. Connect the repo.
5. Use these settings:

```text
Build Command: npm install && npm run build
Publish Directory: dist
```

6. Add environment variables:

```text
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anon public key>
```

7. Add this rewrite rule if Render does not pick up `render.yaml`:

```text
Source: /*
Destination: /index.html
Action: Rewrite
```

The rewrite keeps client-side navigation working after a page refresh.

## Notes

- Render Static Sites are appropriate for this frontend because Supabase provides the database, auth, and API layer.
- Keep `VITE_SUPABASE_ANON_KEY` public. Never expose the service-role key in a browser app.
- The app runs in demo mode without env vars, but live accounts and live data require the two `VITE_SUPABASE_*` values.
