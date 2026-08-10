-- An administrator has already manually reviewed a listing they add, so allow
-- that insert to be published immediately. Parent submissions stay drafts.
drop policy if exists "Admins can publish activity submissions" on public.activities;

create policy "Admins can publish activity submissions"
on public.activities
for insert
to authenticated
with check (public.is_tiny_outings_admin());
