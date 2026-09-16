# Shadow image model review

The replacement `/review/` app has one purpose: inspect model-selected photos for every active published or draft listing and record **Approve**, **Reject**, or **Unsure**. The selected image can be compared with alternative images, and the original image, hosting page, activity link, and complete stored image metadata can be opened. Publication-status and review-state filters are independent.

The local batch never calls SerpAPI, a hosted model, or the OpenAI API. It reads a fresh linked-database snapshot, screens every saved non-human candidate, then uses the trained desktop-review SigLIP 2 ranker on the top 20 metadata candidates plus source-diverse extras per activity. The shortlist was checked on the existing held-out set: 81 of 82 eligible exact desktop-chosen originals remained available for vision assessment. This is *shortlist recall*, not top-one accuracy or proof of suitability. Existing quality, conflict, resolution, utility-asset, and Wikimedia-category gates remain active.

Run:

```powershell
node scripts/prepare-shadow-image-batch.js
node scripts/run-shadow-image-model.js
node scripts/finalize-shadow-image-proposals.js
node scripts/upload-shadow-image-proposals.js
```

The third command finalizes the alternatives and run totals; the fourth prepares SQL files only. After the model batch is complete and the isolated review-table migration has been applied, `node scripts/upload-shadow-image-proposals.js --apply` uploads only to `activity_image_model_proposals`. Neither inference nor review decisions update `activities` or change a live card image. Re-running an upload preserves existing decisions. The app uses the admin-only `image-model-review` Edge Function. A separate explicit promotion workflow would be required to put approved choices into `reviewed_image_url`.

The main-app display hierarchy is admin cover, admin-provided URL, manually reviewed image, then user upload, followed by category artwork. Automatic model and scraper fields are not in the display hierarchy. This was authorised for deployment in Android 2.96; review proposals remain non-live until a separate promotion step.

The old multi-queue desktop app source was removed from the working tree; Git history retains it for rollback. This replacement does not offer its old publishing, archiving, or upload controls.
