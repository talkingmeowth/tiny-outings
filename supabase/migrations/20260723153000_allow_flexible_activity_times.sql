-- Places such as parks and museums can be valid activities without a single
-- fixed session time. The client renders null times as an Anytime activity.
alter table public.activities
  alter column start_time drop not null,
  alter column end_time drop not null;
