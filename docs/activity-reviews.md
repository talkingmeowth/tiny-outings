# Ratings and comments — Android 2.94 (108)

The activity details screen now shows the Tiny Outings community rating and review count below the title, plus a comment preview in **Parents & carers say**. Either opens the full comments view, keeping the existing bottom tabs. Back returns to the same activity, then the previous browsing screen.

The full view includes initials/public display names, each review's rating and date, comment text, sorting (recent/highest/lowest), and batches of 20 visible reviews. Rating-only reviews remain visible. Guests can read; writing still requires sign-in. Existing reviews are prefilled for editing and upserted with the existing activity/user uniqueness constraint. Photos remain supported by the existing upload flow. Saving disables the form, preserves input on failure, and reloads the comments and average after success.

## Data and safeguards

- Reads `activity_reviews` with only the related public `display_name` and `user_name`; no emails or private profile fields are requested.
- Uses the existing public-read and owner-write RLS policies; no database migration or permission change.
- Loads reviews only for an opened activity, with pagination so the aggregate includes every stored rating. Cancels requests when the activity closes/changes.
- Does not mix Google/imported ratings into the community average. No reviews means an explicit empty state, not zero stars or generated sample reviews. Read failures offer retry rather than displaying an empty result.
- Reports use the existing `activity_bug_reports` workflow, including the reported review ID and activity ID. Comments render as text, not HTML.
- No importer, image-selection or desktop queue changes.

## Validation and rollout

218 Node tests; 28 browser smoke checks in each theme (56 total). Browser checks use mocked writes and cover rating/count display, comments, sorting, reporting entry, guest sign-in, editing, save failure/retry, refreshed averages, no duplicate reviews, back navigation, read failure/retry, empty state, contrast and narrow-screen overflow. A read-only production check confirmed anonymous review retrieval with the public-author join (HTTP 200). No live sample reviews were created. Native-device interaction testing remains separate from these browser checks.

Run `npm test`, changed-file ESLint, and `scripts/design19-smoke.mjs` with `DESIGN19_TEST_SCHEME=light` and `dark`. Build/package using `npm run android:apk`, then `npm run review:build` and `npm run render:download` for the download host. The app-shell cache is versioned for this release.

Rollback: revert the isolated ratings/comments commit and rebuild with a higher Android version code. Stored reviews and permissions are unchanged and need no data rollback.
