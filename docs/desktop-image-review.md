# Desktop Image Review Queue

The desktop review app lives at `/review/`. It is a separate, laptop-first React entry point and is protected by Supabase Google sign-in plus the existing Tiny Outings administrator allowlist.

## Image discovery uses SerpAPI

When an administrator opens a listing without candidates, or requests a different search, the app creates a request and immediately calls SerpAPI's `google_images` search. The query is normally the activity name plus the most useful location without duplicated place names.

The first 20 `images_results` are stored and displayed in exactly the order returned. Candidate discovery does not filter by quality, resolution, logos, Wikimedia, source, duplication, or relevance. The administrator makes that judgment in the gallery.

Each result is adapted to this display shape without changing its rank:

   ```json
   {
     "image_url": "https://example.org/full-image.jpg",
     "thumbnail_url": "https://example.org/thumbnail.jpg",
     "source_page_url": "https://example.org/venue-page",
     "source_domain": "example.org",
     "title": "Venue gallery",
     "width": 1600,
     "height": 1067,
     "relevance_reason": "Google Images result 1"
   }
   ```

The app also retains the raw top-20 result fields in `serpapi_image_candidates`. The existing `codex_image_*` column names remain as the desktop gallery's storage contract, but `codex_image_search_model` clearly records `SerpAPI Google Images — top 20 unfiltered`.

## Saving a reviewed image

Selecting a candidate calls the admin-only `image-review-admin` Edge Function. The function downloads the remote file, checks its MIME type, byte size, pixel dimensions, obvious logo/icon terms, and Wikimedia category policy, then stores it under `activity-images/reviewed/`. It writes the public Storage URL to `activities.reviewed_image_url` and records the original/source URLs and a permanent row in `activity_image_manual_reviews`.

`reviewed_image_url` is directly below `admin_cover_image_url` in the card-image hierarchy. It is not an audit replacement field; `audit_image_url` remains reserved for automated audit replacements.

## Local development

Use `npm run review:dev`, then open `http://localhost:5174/review/`. For visual-only local QA without authentication, append `?demo=1`; demo mode exists only in Vite development builds.
