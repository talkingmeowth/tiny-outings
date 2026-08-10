-- New activity submissions are drafts. Only the Tiny Outings administrator may
-- see the shared review queue before deciding whether to publish or archive.
drop policy if exists "Admins can read draft activities" on public.activities;

create policy "Admins can read draft activities"
on public.activities
for select
using (
  public_listing_status = 'draft'
  and public.is_tiny_outings_admin()
);

comment on policy "Admins can read draft activities" on public.activities is
  'Keeps community-submitted draft listings private until the designated administrator reviews them.';
