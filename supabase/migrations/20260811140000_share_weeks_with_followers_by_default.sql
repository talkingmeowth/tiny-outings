-- Planning is a social feature by default. Every parent can still switch their
-- profile back to private or public from the Week page.
alter table public.user_table
  alter column default_calendar_visibility set default 'followers';

update public.user_table
set default_calendar_visibility = 'followers'
where default_calendar_visibility = 'private';

update public.calendar_events
set visibility = 'followers'
where visibility = 'private';
