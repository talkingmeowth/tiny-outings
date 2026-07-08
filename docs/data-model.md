# Data Model

This app uses Supabase Auth for sign-in and `public.user_table` for user profile data.

## Core Tables

- `activities`: Source activity listings, including venue, times, category, age suitability, and location.
- `user_table`: App profile for each authenticated user. Stores `user_name`, profile fields, and follower/following counts.
- `user_follows`: Normalized follow graph. This keeps follower data queryable and updates `user_table.followers` and `user_table.following`.
- `comments_table`: Comments left by users on activities.
- `activity_swipes`: One swipe decision per user, activity, date, and day window.
- `activity_shortlist`: Activities a user swiped yes to for a particular date and morning/afternoon/evening slot.
- `activity_user_statuses`: Per-user status for an activity: `booked`, `tentative`, or `not_selected`.
- `calendar_events`: The single chosen calendar event for a user's date and time window.
- `calendar_event_exports`: External calendar export records, including Google Calendar event IDs later.
- `activity_reviews`: User ratings and review text.
- `activity_photos`: User-uploaded or external-source activity photos.

## Visibility

Calendar events and activity statuses can be:

- `private`: only the owner can see them.
- `followers`: visible to users following the owner.
- `public`: visible to anyone.

## Swipe Flow

1. User filters activities.
2. App records each left/right swipe in `activity_swipes`.
3. Right swipes can be copied into `activity_shortlist`.
4. User selects one shortlist item for the slot.
5. App writes `activity_user_statuses` and `calendar_events`.
6. If the user exports, the app writes `calendar_event_exports`.

## Friend Signals

When swiping, the app can query `activity_user_statuses` or the `followed_activity_statuses` view to show whether followed users have selected the same activity.
