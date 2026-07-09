# Data Model

This app uses Supabase Auth for sign-in and `public.user_table` for user profile data.

## Core Tables

- `activities`: Source activity listings, including venue, times, category, age suitability, location, optional Google Places metadata, and card image fields.
- `user_table`: App profile for each authenticated user. Stores `user_name`, `username_completed`, profile fields, and follower/following counts.
- `user_follows`: Normalized follow graph. This keeps follower data queryable and updates `user_table.followers` and `user_table.following`.
- `comments_table`: Comments left by users on activities.
- `activity_swipes`: One swipe decision per user, activity, date, and day window.
- `activity_shortlist`: Activities a user swiped yes to for a particular date and morning/afternoon/evening slot.
- `activity_user_statuses`: Per-user status for an activity: `booked`, `tentative`, or `not_selected`.
- `calendar_events`: The single chosen calendar event for a user's date and time window.
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

Calendar events and activity statuses can be:

- `private`: only the owner can see them.
- `followers`: visible to users following the owner.
- `public`: visible to anyone.

## Swipe Flow

1. User signs in with Google and creates a username.
2. User filters activities.
3. App records each left/right swipe in `activity_swipes`.
4. Right swipes can be copied into `activity_shortlist`.
5. User selects one shortlist item for the slot.
6. App writes `activity_user_statuses` and `calendar_events`.
7. If the user exports, the app writes `calendar_event_exports`.

## Friend Signals

When swiping, the app can query `activity_user_statuses` or the `followed_activity_statuses` view to show whether followed users have selected the same activity.

## Google Places Autofill

The add tab sends a pasted link to the `activity-link-autofill` Supabase Edge Function. The function calls Google Places server-side, then returns normalized values for the `activities` table, including Google entry URL, photo URL, rating, review count, primary type, opening hours, and summary when available. If Google has no photo, the function attempts to pull an Open Graph/Twitter image from the activity website.

The Google API key must be set as a Supabase Edge Function secret named `GOOGLE_MAPS_API_KEY`. The mobile frontend should only use the Supabase publishable key.
