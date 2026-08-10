-- Reviews and ratings are attributable to a signed-in Tiny Outings account.
drop policy if exists "Anonymous users can create activity reviews" on public.activity_reviews;
