# Simple image selection — Codex chat, not a model API

## One display rule

1. Admin cover.
2. Manually reviewed choice (including an explicitly selected category illustration).
3. Admin-provided URL and user upload.
4. One cross-source photo selected by vision in the current Codex chat.
5. Category illustration when no suitable photo can be verified.

This is already the main app's display order. Website/organiser/SerpAPI/audit
fields are candidate sources, not additional automatic fallback winners. Human
choices are protected both before preparation and again under a database row
lock at application time. Quick-approved exact image URLs are protected too.

The new simpler missing-photo screen is `/review/?view=missing`. Published
items come first; drafts follow. Choose a source-labelled candidate or upload
a photo, then **Save photo & next**. Candidate picks use the existing review
save. Uploads are decoded and re-encoded without EXIF in the browser, checked
on the server, stored in `activity-images`, saved to `reviewed_image_url`, and
logged as manual ground truth in the same database transaction. Failed or
stale uploads cannot overwrite a newer choice. Category-art cases remain
missing; Skip only skips this session and makes no database change.

## Importer and chat boundary

The existing importer retains complete cached image discovery from listing
and organiser websites and the one-attempt SerpAPI collection. It no longer
runs independent website, SerpAPI and learned-ranker selection stages or
propagates old automatic family-image guesses before review.

It runs `node scripts/prepare-chat-image-selection.js --created-after TIMESTAMP
--limit 1000`. This fetches existing data and original image files, checks
dimensions/formats, and creates sheets containing **every readable candidate**
in groups of 20. It neither calls an LLM API nor starts a separate Codex/model
process. The audit explicitly says `awaiting_codex_chat_review`.

**An unattended importer cannot invoke this live chat.** After import, Codex
must open the generated sheets in this chat, inspect their activity and source
metadata, open the proposed winner at full size, and record the decision.
Preparing a sheet does not mean the LLM has reviewed it. Unreadable images are
recorded as unavailable, never as visually rejected. No new SerpAPI request is
made by preparation or selection. Stored-candidate review can be resumed with
`node scripts/prepare-chat-image-selection.js --pending --limit 20`.

`apply-chat-image-selection.js --bundle PATH --decision PATH` validates the
chat receipt, all candidate IDs and local pixel hashes. `--apply` additionally
requires a live record revision and protected database RPC. Evaluation bundles
have no live revision and cannot apply. It writes `model_selected_url`, not a
manual-review field; a null decision clears only the model selection and uses
the normal category fallback. Existing remote URLs are preserved; this does
not claim to create a fresh hosted copy of every selected original.

The source context includes the activity title/description/category/age,
address/postcode/borough, website, organiser, Google summary/type/place link,
and complete cached candidate metadata. Conflicting providers or places are
not rescued by a similar name. Logos, maps, award badges, unrelated portraits,
wrong activities and poor-quality photos do not win. A verified venue photo
may be used when no better photograph of the session exists.

## Diagnostic conducted in this chat

Nine selected difficult cases, 105 readable candidates, six photos selected,
three category-art decisions. The six photo choices comprised **three with an
explicit acceptable human label and three unlabelled alternatives**. None of
the three labelled choices was labelled unsuitable. One abstention (Musical
Hatchlings) had a known acceptable human alternative: this is a real coverage
miss to investigate, not a success. Stay and Play and Cloud 9 Yoga had no
explicit acceptable label in their partial assessments.

| Minimum evidence score | Photos / 9 cases | Photo coverage | Labelled acceptable / labelled selected | Unlabelled selections |
|---|---:|---:|---:|---:|
| 0.65 | 6 / 9 | 67% | 3 / 3 | 3 |
| 0.75 | 6 / 9 | 67% | 3 / 3 | 3 |
| 0.85 | 4 / 9 | 44% | 1 / 1 | 3 |
| 0.90 | 3 / 9 | 33% | 1 / 1 | 2 |
| 0.95 | 1 / 9 | 11% | 1 / 1 | 0 |

Four cases came from previously reserved splits: three photos, two explicitly
acceptable, one unlabelled, one abstention. This conversation has already seen
some feedback, so this is **not a pristine blinded holdout test**. The sample
is small and deliberately selected; scores are not calibrated probabilities.
Do not call this 100% model accuracy. Do not retune on the reserved answers.
Full case decisions and reasons are in `output/chat-image-evaluation/`.

Recommendation: use the simple rule and exact identity/quality checks; retain
the conservative provisional 0.65 operating score, without interpreting it as
65% correctness. Higher cutoffs discarded useful coverage in this diagnostic
but did not establish a measurable accuracy gain. Use existing labels for
further evaluation; no additional user tagging is required. The diagnostic
did not bulk-overwrite any live activity images or mark the historical model
backlog as newly chat-reviewed.

## Verification and rollback

- Node unit/regression suite, desktop production build, Deno endpoint check.
- Phone (390px) and desktop browser checks: candidate selection, upload preview,
  save/next, updated counts, empty queue; demo only, no test photos left live.
- Database transaction/rollback test verifies upload + evidence and protection.
- Independent admin-authenticated function `image-review-simple`; existing
  review/approval functions unchanged. No APK rebuild or mobile UI changes.
- Roll back the scoped UI/importer commit to restore the previous interface;
  keep the additive table/RPC and saved human uploads. No image deletion needed.
