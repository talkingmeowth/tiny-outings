# Desktop Image Review Queue

The desktop review app lives at `/review/`. It is a separate, laptop-first React entry point and is protected by Supabase Google sign-in plus the existing Tiny Outings administrator allowlist.

## Image discovery uses Codex chat

The app deliberately does not call SerpAPI, the OpenAI API, or any other model API. It does not need an OpenAI API key.

When an administrator opens a listing without candidates, or requests a different search, the app adds a row to `public.codex_image_candidate_requests`. It then polls Supabase for the result. The request contains the listing ID and generated query, normally the activity name plus the most useful location without duplicated place names.

To fill queued requests, tell Codex in the project chat:

> Process the pending desktop image candidate requests.

Codex should then:

1. Read pending rows, oldest first, joined to their activity details.
2. Mark each row `in_progress` and set `started_at`.
3. Use Codex image search for the stored query, refining with the provider, address, category, and London context where useful.
4. Visually assess the results for identity, accuracy, representativeness, and quality. Reject icons, logos, maps, posters, text graphics, tiny images, unrelated venues, and misleading crops. For cafes, prefer a clear interior with seating, then a useful exterior; do not choose a food-only close-up.
5. Keep 12–20 strong candidates, subject to availability. Do not use Wikimedia outside Parks & outdoor play, Museums & culture, and Family activities.
6. Write the candidate array to the matching activity using this shape:

   ```json
   {
     "image_url": "https://example.org/full-image.jpg",
     "thumbnail_url": "https://example.org/thumbnail.jpg",
     "source_page_url": "https://example.org/venue-page",
     "source_domain": "example.org",
     "title": "Venue gallery",
     "width": 1600,
     "height": 1067,
     "relevance_reason": "Clear interior showing the cafe seating and layout."
   }
   ```

7. Set `codex_image_search_query`, `codex_image_searched_at`, and `codex_image_search_model` on the activity. Complete the request with `status = 'completed'`, `completed_at`, `candidate_count`, and the Codex model name. Record `failed` and a concise `failure_reason` when no reliable candidates can be supplied.

The desktop app notices completed rows within about five seconds and displays the candidates.

## Saving a reviewed image

Selecting a candidate calls the admin-only `image-review-admin` Edge Function. The function downloads the remote file, checks its MIME type, byte size, pixel dimensions, obvious logo/icon terms, and Wikimedia category policy, then stores it under `activity-images/reviewed/`. It writes the public Storage URL to `activities.reviewed_image_url` and records the original/source URLs and a permanent row in `activity_image_manual_reviews`.

`reviewed_image_url` is directly below `admin_cover_image_url` in the card-image hierarchy. It is not an audit replacement field; `audit_image_url` remains reserved for automated audit replacements.

## Local development

Use `npm run review:dev`, then open `http://localhost:5174/review/`. For visual-only local QA without authentication, append `?demo=1`; demo mode exists only in Vite development builds.
