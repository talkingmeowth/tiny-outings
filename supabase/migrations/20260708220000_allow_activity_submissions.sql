alter table public.activities
  add column if not exists submitted_by_user_id uuid references public.user_table (user_id) on delete set null,
  add column if not exists submission_notes text;

create index if not exists activities_submitted_by_user_idx
  on public.activities (submitted_by_user_id);

drop policy if exists "Users can read own draft activities" on public.activities;
drop policy if exists "Users can submit draft activities" on public.activities;
drop policy if exists "Users can update own draft activities" on public.activities;

create policy "Users can read own draft activities"
on public.activities
for select
using (
  submitted_by_user_id = auth.uid()
  and public_listing_status = 'draft'
);

create policy "Users can submit draft activities"
on public.activities
for insert
with check (
  submitted_by_user_id = auth.uid()
  and public_listing_status = 'draft'
);

create policy "Users can update own draft activities"
on public.activities
for update
using (
  submitted_by_user_id = auth.uid()
  and public_listing_status = 'draft'
)
with check (
  submitted_by_user_id = auth.uid()
  and public_listing_status = 'draft'
);
