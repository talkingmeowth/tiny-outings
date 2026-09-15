# Mobile image training review

Open https://tiny-outings-cpjh.onrender.com/review/?view=training&batch=image-training-2026-09 and sign in with an existing administrator Google account. The desktop tool also has an **Improve image model** link. No APK update is needed.

## Exactly how to review

1. Read the activity name, description, address and provider information. Use **Activity website**, **Organiser** or **Google Places** when the identity is unclear.
2. Inspect the first 20 images, enlarging images before judging quality. Mark **Usable** on *all* genuinely suitable photos you inspect, not just your favourite. Use **Show 20 more** to examine the rest of the stored pool when needed.
3. Pick one **Favourite**: the most accurate, clear and informative cover. For a café prefer the interior/seating/exterior; for a class prefer the activity experience. A headshot, logo, timetable, generic building, unrelated activity or wrong venue is generally unsuitable. A verified branded class photograph may represent the same programme at several branches, but a different venue's exterior/interior must not represent this venue.
4. On unsuitable photos choose the reason: wrong activity, place, provider, logo/graphic, poor quality or poor representation. Use **Not sure** if you cannot verify it; **Can't view** if the original/source is inaccessible. These are not negatives.
5. Leave **I have chosen a favourite photo**, then **Save & next**. If nothing you inspected is suitable, choose **None I checked is suitable — use category art**. If there are no usable candidates to inspect, choose **Need more images**. For uncertain activity identity choose **I cannot verify this activity**.

You do not have to judge every image. Unlabelled images stay unlabelled, never automatically rejected. The first 20 are mixed across sources, not ranked by the model. Previous model choices and manual “winner” labels are hidden to reduce bias. Candidate website/domain and dimensions remain visible.

Saved reviews sync across devices. Unsubmitted drafts stay only on the current device/account. Retry failed saves before leaving; server acknowledgement is required before advancing. You may revisit completed or deferred cases using the filters. Revisions retain the previous review in history.

**These are training labels, not live image edits.** Saving does not change `reviewed_image_url`, `model_selected_url`, category-art selection or publication status. Use the existing full review tool for a live cover correction.

## Initial batch

250 independent activity groups, from the cached 15 September 2026 snapshot; all selected listing IDs are checked as active at import time. 7,821 deduplicated URL candidates; exact URL duplicates merge their source labels. Re-encoded/visually duplicated files may still appear. Seven cases currently have no cached photos; use **Need more images** for these, not a negative label.

The 200 targeted development cases comprise 60 model disagreements, 53 missing/low-confidence cases, 35 cases whose old reference was outside the automatic pool, 25 regressions, 19 reported semantic/shared-class risks and eight prior explicit model rejections. A further 25 previously unlabelled groups are reserved for calibration and 25 for holdout testing. Sampling reasons and splits are hidden from reviewers. The batch is stratified across categories/importers, not a random estimate of overall app accuracy.

Examples include Fun For All, Baby Massage, Buggy Walk at Waterways Children's Centre, Clissold Park splash pad and CLOUD 9 KIDS YOGA. The exact case list and immutable candidate/context hashes are stored in `image_training_cases`.

## Implementation and repeatability

- Entry: `?view=training`; separate lazy-loaded component. It does not mount the desktop queue or trigger its SerpAPI preloader.
- Admin-authenticated Edge Function: `image-training-review`, actions `list`, `case`, `save`.
- Tables: `image_training_batches`, `image_training_cases`, append-only `image_training_reviews`. Direct anonymous/authenticated table access is revoked; the function verifies the signed-in administrator.
- Each label refers to a server-owned candidate ID and immutable candidate/context hash. Foreign candidates, stale hashes, contradictory outcomes and invalid reasons are rejected. Request UUIDs make retries idempotent; reusing one with a different payload fails.
- Sources include all cached SerpAPI, website, organiser website and other search candidates, plus existing saved/reference URLs. No external search or image model call is required to create this batch.
- Recreate from an existing compatible snapshot with `node scripts/prepare-image-training-batch.js --input output/image-selection-v5 --batch image-training-2026-09 --output output/image-training-2026-09`. Writes a manifest and small SQL chunks. Apply each generated `seed.part-XX.sql` using `npx supabase db query --linked --file <path>`. Inserts are rerunnable and never overwrite case snapshots or reviews. Use a new batch ID for a changed candidate set.
- Only apply migration `20260916110000_add_mobile_image_training_review.sql`; unrelated experimental migrations are not prerequisites.
- Run `node --test desktop-review/src/trainingReview.test.js scripts/lib/image-training-cases.test.js`, `npm run review:build`, and `npx supabase db query --linked --file scripts/test-image-training-review.sql`. Database integration tests roll back all their synthetic data.

## How the labels should improve the model

`image_training_development_examples` is the training input: only explicit `acceptable` and `unsuitable` development labels, using the latest case revision. Related calibration/holdout groups are excluded even across batches. Combine these development labels with existing trusted admin/manual examples, preserving explicit negatives and favourite-vs-acceptable distinctions. The gallery reference URLs are available but their prior winner status is not shown.

`image_training_labelled_examples` retains all splits and uncertainty/unavailability outcomes for separate analysis. Never train on its unfiltered contents. Known activity families, recurrences and shared reference URLs are grouped before sampling; evaluation groups have no existing reference labels in the source snapshot. Recheck grouping and duplicate-image leakage against any later ground-truth export before retraining, particularly visual re-encodes and newly reviewed related listings.

After labels arrive, report: preferred-image top-1/top-3, acceptable-image precision among *explicitly assessed* choices, assessed-choice coverage, full-pool label coverage, bad-source/location error rates, and photo coverage vs abstention at thresholds. Predictions on unlabelled photos are unknown, not errors or successes. “None I checked” is not proof that the entire candidate pool is unsuitable. Calibrate using the 25 calibration groups, then evaluate once on the untouched 25 holdout groups; report sample sizes and uncertainty intervals. This small holdout is an initial diagnostic, not enough to certify a 95% accuracy claim. Collect a larger representative holdout before broad confidence-based rollout.

This feature collects the labels; it does **not** automatically retrain or deploy the experimental selector.

## Rollback

Revert the scoped mobile-training UI commit and redeploy the review site. Keep the three new tables/reviews so the user's work is retained. Existing queues, the mobile APK and production selection logic are unchanged by this release.
