-- Every community listing, including one submitted by an administrator, stays
-- in the draft queue until an administrator explicitly approves it.
drop policy if exists "Admins can publish activity submissions" on public.activities;
