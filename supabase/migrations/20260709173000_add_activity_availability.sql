alter table public.activities
  add column if not exists activity_date date,
  add column if not exists available_dates date[] not null default '{}',
  add column if not exists availability_start_date date,
  add column if not exists availability_end_date date,
  add column if not exists available_days_of_week text[] not null default '{}',
  add column if not exists availability_type text not null default 'recurring' check (
    availability_type in ('daily', 'weekly', 'date_range', 'specific_dates', 'seasonal', 'one_off', 'recurring', 'unknown')
  ),
  add column if not exists availability_notes text;

create index if not exists activities_activity_date_idx
  on public.activities (activity_date);

create index if not exists activities_available_dates_idx
  on public.activities using gin (available_dates);

create index if not exists activities_available_days_of_week_idx
  on public.activities using gin (available_days_of_week);

create index if not exists activities_availability_range_idx
  on public.activities (availability_start_date, availability_end_date);

comment on column public.activities.activity_date is
  'Specific date for a one-off activity or next known occurrence.';

comment on column public.activities.available_dates is
  'Explicit list of dates when the activity is available.';

comment on column public.activities.available_days_of_week is
  'Days when the activity is normally available, for recurring or venue-style listings.';

comment on column public.activities.availability_type is
  'Availability model: daily, weekly, date range, specific dates, seasonal, one-off, recurring, or unknown.';

update public.activities
set
  available_days_of_week = days_of_week,
  availability_type = case
    when cardinality(days_of_week) = 7 then 'daily'
    when cardinality(days_of_week) > 0 then 'weekly'
    else availability_type
  end,
  availability_notes = coalesce(availability_notes, schedule_notes)
where cardinality(days_of_week) > 0;
