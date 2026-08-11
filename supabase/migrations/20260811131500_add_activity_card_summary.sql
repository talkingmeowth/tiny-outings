-- Keep the short swipe-card copy separate from the complete activity description.
alter table public.activities
  add column if not exists card_summary text;

comment on column public.activities.card_summary is
  'Short activity summary shown on swipe cards. Generated from a submitted listing and editable by an administrator.';
