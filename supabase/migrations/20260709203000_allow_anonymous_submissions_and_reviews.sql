drop policy if exists "Anonymous users can submit draft activities" on public.activities;

create policy "Anonymous users can submit draft activities"
on public.activities
for insert
with check (
  submitted_by_user_id is null
  and public_listing_status = 'draft'
);

alter table public.activity_reviews
  alter column user_id drop not null;

drop policy if exists "Anonymous users can create activity reviews" on public.activity_reviews;

create policy "Anonymous users can create activity reviews"
on public.activity_reviews
for insert
with check (user_id is null);

drop policy if exists "Anonymous users can add activity photos" on public.activity_photos;

create policy "Anonymous users can add activity photos"
on public.activity_photos
for insert
with check (user_id is null);
