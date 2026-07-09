# Data Model

The current mobile app is account-free. It reads published activities from Supabase, stores planning choices on the device, and allows anonymous draft activity submissions, reviews, and photos.

## Core Tables

- `activities`: Source activity listings, including venue, times, category, age suitability, location, optional Google Places metadata, and card image fields.
- `user_table`: Legacy profile table retained for compatibility with earlier builds.
- `user_follows`: Legacy follow graph retained in the database but not used by the current app.
- `comments_table`: Comments left by users on activities.
- `activity_swipes`: Legacy server-side swipe table. The current app stores swipes locally.
- `activity_shortlist`: Legacy server-side shortlist table. The current app stores shortlist choices locally.
- `activity_user_statuses`: Legacy per-user activity status table. The current app stores statuses locally.
- `calendar_events`: Legacy server-side calendar table. The current app stores calendar choices locally.
- `calendar_event_exports`: External calendar export records, including Google Calendar event IDs later.
- `activity_reviews`: User ratings and review text.
- `activity_photos`: User-uploaded or external-source activity photos.

## Activity Availability

The `activities` table now supports several date patterns:

- `activity_date`: one exact date, useful for one-off events.
- `available_dates`: explicit dates when an activity is available.
- `availability_start_date` and `availability_end_date`: date ranges, including seasonal listings.
- `available_days_of_week`: recurring weekly availability for venues and sessions.
- `availability_type`: `daily`, `weekly`, `date_range`, `specific_dates`, `seasonal`, `one_off`, `recurring`, or `unknown`.
- `availability_notes`: human-readable context such as "check venue before travelling" or seasonal closure notes.

The mobile app filters the swipe deck by the selected planning week/day and only shows activities available on that selected date.

## Activity Images

Activity cards use the first available image source in this order:

- `google_photo_url` from Google Places.
- `image_url`, usually an activity website Open Graph/Twitter image found by the Edge Function.
- A website-derived preview generated from the activity website/source URL.

## Visibility

Calendar events in the current app can be:

- `private`: only the owner can see them.
- `public`: visible when exported/shared outside the app.

## Swipe Flow

1. User filters activities.
2. App records each left/right swipe in local storage.
3. Right swipes are copied into a local shortlist for the selected date and time window.
4. User selects one shortlist item for the slot.
5. App writes the chosen activity into the local in-app calendar.
6. If the user exports, the app generates a Google Calendar URL or ICS file.

## Google Places Autofill

The add tab sends a pasted link to the `activity-link-autofill` Supabase Edge Function. The function calls Google Places server-side, then returns normalized values for the `activities` table, including Google entry URL, photo URL, rating, review count, primary type, opening hours, and summary when available. If Google has no photo, the function attempts to pull an Open Graph/Twitter image from the activity website.

The Google API key must be set as a Supabase Edge Function secret named `GOOGLE_MAPS_API_KEY`. The mobile frontend should only use the Supabase publishable key.

## Anonymous Contributions

`20260709203000_allow_anonymous_submissions_and_reviews.sql` allows the account-free app to insert:

- Draft activities with `submitted_by_user_id` set to `null`.
- Activity reviews with `user_id` set to `null`.
- Activity photos with `user_id` set to `null`.
