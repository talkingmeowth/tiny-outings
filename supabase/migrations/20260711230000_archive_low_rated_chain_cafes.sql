-- Keep the cafe directory family-oriented using transparent, review-based quality signals.
-- Unrated local and family-hub cafes are retained for separate editorial review.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where source_name = 'Google Places API London family directory'
  and category = 'Child-friendly cafes'
  and coalesce(google_rating, app_rating) < 3.8
  and coalesce(google_user_rating_count, number_of_reviews, 0) >= 10;
