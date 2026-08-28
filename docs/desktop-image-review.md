# Desktop Image Review Queue

The desktop review app lives at `/review/`. It is a separate, laptop-first React entry point and is protected by Supabase Google sign-in plus the existing Tiny Outings administrator allowlist.

## Image discovery uses SerpAPI

The initial queue load omits the large candidate JSON arrays so thousands of listings can appear quickly. When an administrator selects a listing, the app lazy-loads only that listing's saved candidates. If none exist, it immediately calls SerpAPI's `google_images` search; legacy pending Codex-chat request rows never block the call. The query is normally the activity name plus the most useful location without duplicated place names.

The admin Edge Function creates and completes the request log itself, cancelling any obsolete `pending` or `in_progress` row for the listing. This keeps the browser path to one server invocation instead of separate cancel, insert, and search round trips.

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

Each candidate has a **View large** control that opens the highest-resolution returned image in a desktop lightbox. The candidate and lightbox both expose the source webpage, and the lightbox also exposes the original image-file URL. Zooming or opening a link does not select the candidate.

## Saving a reviewed image

Selecting a candidate calls the admin-only `image-review-admin` Edge Function. The function downloads the remote file, checks its MIME type, byte size, pixel dimensions, obvious logo/icon terms, and Wikimedia category policy, then stores it under `activity-images/reviewed/`. It writes the public Storage URL to `activities.reviewed_image_url` and records the original/source URLs and a permanent row in `activity_image_manual_reviews`.

Social websites are allowed as source pages when the administrator selects a genuine activity photo; a source domain such as Instagram is not itself evidence that the asset is a logo or icon. If the original host does not expose a downloadable image, the function tries the Google Images thumbnail and still enforces the minimum byte and pixel dimensions. Edge Function failures are decoded in the desktop UI so the administrator sees the specific reason instead of a generic non-2xx message.

`reviewed_image_url` is directly below `admin_cover_image_url` in the card-image hierarchy. It is not an audit replacement field; `audit_image_url` remains reserved for automated audit replacements.

## Automated review queue

`npm run activities:images:auto-review` learns a candidate-ranking model from every row in `activity_image_manual_reviews`. Each manual selection is a positive example and the other candidates shown for that listing are implicit negative examples. The model uses the learned result-position, source-domain, title relevance, reported resolution, framing, category, and official-source preferences to rank stored candidates for active Missing and Unsuitable listings.

Add `--apply` to stage the recommendations in `activity_image_automated_reviews` and immediately download each choice into Storage as `reviewed_image_url`. Applied rows remain in an `auto_applied` state in the desktop app's **Automated review** queue. A human confirmation changes one to `approved` and removes it from the queue; choosing another candidate records `corrected`. `npm run activities:images:auto-review:approve` can resume any interrupted application batch. `--search-missing` may be added when a deliberate SerpAPI backfill is wanted for listings that have no stored candidate set.

## Local development

Use `npm run review:dev`, then open `http://localhost:5174/review/`. For visual-only local QA without authentication, append `?demo=1`; demo mode exists only in Vite development builds.
