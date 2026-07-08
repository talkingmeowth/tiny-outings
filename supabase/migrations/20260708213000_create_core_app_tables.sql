create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_type.typname = 'calendar_visibility'
      and pg_namespace.nspname = 'public'
  ) then
    create type public.calendar_visibility as enum ('private', 'followers', 'public');
  end if;

  if not exists (
    select 1
    from pg_type
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_type.typname = 'activity_user_status'
      and pg_namespace.nspname = 'public'
  ) then
    create type public.activity_user_status as enum ('booked', 'tentative', 'not_selected');
  end if;

  if not exists (
    select 1
    from pg_type
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_type.typname = 'swipe_decision'
      and pg_namespace.nspname = 'public'
  ) then
    create type public.swipe_decision as enum ('yes', 'no');
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.user_table (
  user_id uuid primary key references auth.users (id) on delete cascade,
  user_name text not null,
  display_name text,
  avatar_url text,
  bio text,
  home_borough text,
  default_calendar_visibility public.calendar_visibility not null default 'private',

  -- Counts are maintained by triggers on public.user_follows.
  followers integer not null default 0 check (followers >= 0),
  following integer not null default 0 check (following >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_table_user_name_length check (char_length(user_name) between 3 and 30),
  constraint user_table_user_name_format check (user_name ~ '^[A-Za-z0-9_.]+$')
);

create unique index if not exists user_table_user_name_lower_idx
  on public.user_table (lower(user_name));

drop trigger if exists set_user_table_updated_at on public.user_table;

create trigger set_user_table_updated_at
before update on public.user_table
for each row
execute function public.set_updated_at();

create table if not exists public.user_follows (
  follower_user_id uuid not null references public.user_table (user_id) on delete cascade,
  followed_user_id uuid not null references public.user_table (user_id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (follower_user_id, followed_user_id),
  constraint user_follows_no_self_follow check (follower_user_id <> followed_user_id)
);

create index if not exists user_follows_follower_idx
  on public.user_follows (follower_user_id);

create index if not exists user_follows_followed_idx
  on public.user_follows (followed_user_id);

create or replace function public.update_user_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.user_table
    set following = following + 1
    where user_id = new.follower_user_id;

    update public.user_table
    set followers = followers + 1
    where user_id = new.followed_user_id;

    return new;
  elsif tg_op = 'DELETE' then
    update public.user_table
    set following = greatest(following - 1, 0)
    where user_id = old.follower_user_id;

    update public.user_table
    set followers = greatest(followers - 1, 0)
    where user_id = old.followed_user_id;

    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists update_user_follow_counts_on_insert on public.user_follows;
drop trigger if exists update_user_follow_counts_on_delete on public.user_follows;

create trigger update_user_follow_counts_on_insert
after insert on public.user_follows
for each row
execute function public.update_user_follow_counts();

create trigger update_user_follow_counts_on_delete
after delete on public.user_follows
for each row
execute function public.update_user_follow_counts();

create table if not exists public.comments_table (
  comment_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (activity_id) on delete cascade,
  user_id uuid not null references public.user_table (user_id) on delete cascade,
  comments text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint comments_table_comments_not_blank check (char_length(trim(comments)) > 0)
);

create index if not exists comments_table_activity_idx
  on public.comments_table (activity_id, created_at desc);

create index if not exists comments_table_user_idx
  on public.comments_table (user_id, created_at desc);

drop trigger if exists set_comments_table_updated_at on public.comments_table;

create trigger set_comments_table_updated_at
before update on public.comments_table
for each row
execute function public.set_updated_at();

create table if not exists public.activity_swipes (
  swipe_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_table (user_id) on delete cascade,
  activity_id uuid not null references public.activities (activity_id) on delete cascade,
  planned_date date not null,
  day_window text not null check (day_window in ('morning', 'afternoon', 'evening')),
  decision public.swipe_decision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, activity_id, planned_date, day_window)
);

create index if not exists activity_swipes_user_slot_idx
  on public.activity_swipes (user_id, planned_date, day_window);

create index if not exists activity_swipes_activity_idx
  on public.activity_swipes (activity_id);

drop trigger if exists set_activity_swipes_updated_at on public.activity_swipes;

create trigger set_activity_swipes_updated_at
before update on public.activity_swipes
for each row
execute function public.set_updated_at();

create table if not exists public.activity_shortlist (
  shortlist_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_table (user_id) on delete cascade,
  activity_id uuid not null references public.activities (activity_id) on delete cascade,
  planned_date date not null,
  day_window text not null check (day_window in ('morning', 'afternoon', 'evening')),
  added_from_swipe_id uuid references public.activity_swipes (swipe_id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, activity_id, planned_date, day_window)
);

create index if not exists activity_shortlist_user_slot_idx
  on public.activity_shortlist (user_id, planned_date, day_window, position);

drop trigger if exists set_activity_shortlist_updated_at on public.activity_shortlist;

create trigger set_activity_shortlist_updated_at
before update on public.activity_shortlist
for each row
execute function public.set_updated_at();

create table if not exists public.activity_user_statuses (
  status_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_table (user_id) on delete cascade,
  activity_id uuid not null references public.activities (activity_id) on delete cascade,
  planned_date date not null,
  day_window text not null check (day_window in ('morning', 'afternoon', 'evening')),
  status public.activity_user_status not null default 'tentative',
  visibility public.calendar_visibility not null default 'private',
  source text not null default 'manual' check (source in ('manual', 'swipe', 'shortlist', 'calendar_export')),
  selected_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, activity_id, planned_date, day_window)
);

create index if not exists activity_user_statuses_user_slot_idx
  on public.activity_user_statuses (user_id, planned_date, day_window, status);

create index if not exists activity_user_statuses_activity_idx
  on public.activity_user_statuses (activity_id, planned_date, day_window, status);

drop trigger if exists set_activity_user_statuses_updated_at on public.activity_user_statuses;

create trigger set_activity_user_statuses_updated_at
before update on public.activity_user_statuses
for each row
execute function public.set_updated_at();

create table if not exists public.calendar_events (
  calendar_event_id uuid primary key default gen_random_uuid(),
  status_id uuid references public.activity_user_statuses (status_id) on delete set null,
  user_id uuid not null references public.user_table (user_id) on delete cascade,
  activity_id uuid not null references public.activities (activity_id) on delete cascade,
  planned_date date not null,
  day_window text not null check (day_window in ('morning', 'afternoon', 'evening')),
  start_time time without time zone not null,
  end_time time without time zone not null,
  timezone text not null default 'Europe/London',
  status public.activity_user_status not null default 'tentative',
  visibility public.calendar_visibility not null default 'private',
  title_override text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_events_valid_time_range check (end_time > start_time),
  constraint calendar_events_status_not_unselected check (status in ('booked', 'tentative')),
  unique (user_id, planned_date, day_window)
);

create index if not exists calendar_events_user_date_idx
  on public.calendar_events (user_id, planned_date, day_window);

create index if not exists calendar_events_activity_idx
  on public.calendar_events (activity_id, planned_date);

drop trigger if exists set_calendar_events_updated_at on public.calendar_events;

create trigger set_calendar_events_updated_at
before update on public.calendar_events
for each row
execute function public.set_updated_at();

create table if not exists public.calendar_event_exports (
  export_id uuid primary key default gen_random_uuid(),
  calendar_event_id uuid not null references public.calendar_events (calendar_event_id) on delete cascade,
  user_id uuid not null references public.user_table (user_id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'apple_calendar', 'outlook_calendar', 'ics')),
  external_calendar_id text,
  external_event_id text,
  exported_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (calendar_event_id, provider)
);

create index if not exists calendar_event_exports_user_idx
  on public.calendar_event_exports (user_id, provider, exported_at desc);

drop trigger if exists set_calendar_event_exports_updated_at on public.calendar_event_exports;

create trigger set_calendar_event_exports_updated_at
before update on public.calendar_event_exports
for each row
execute function public.set_updated_at();

create table if not exists public.activity_reviews (
  review_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (activity_id) on delete cascade,
  user_id uuid not null references public.user_table (user_id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  child_friendly_score integer check (child_friendly_score between 1 and 5),
  review_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (activity_id, user_id)
);

create index if not exists activity_reviews_activity_idx
  on public.activity_reviews (activity_id, created_at desc);

drop trigger if exists set_activity_reviews_updated_at on public.activity_reviews;

create trigger set_activity_reviews_updated_at
before update on public.activity_reviews
for each row
execute function public.set_updated_at();

create table if not exists public.activity_photos (
  photo_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (activity_id) on delete cascade,
  user_id uuid references public.user_table (user_id) on delete set null,
  photo_url text not null,
  caption text,
  source_provider text not null default 'user_upload' check (source_provider in ('user_upload', 'google_places', 'council_source')),
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists activity_photos_activity_idx
  on public.activity_photos (activity_id, created_at desc);

drop trigger if exists set_activity_photos_updated_at on public.activity_photos;

create trigger set_activity_photos_updated_at
before update on public.activity_photos
for each row
execute function public.set_updated_at();

create or replace view public.followed_activity_statuses
with (security_invoker = true)
as
select
  follows.follower_user_id as viewer_user_id,
  statuses.activity_id,
  statuses.planned_date,
  statuses.day_window,
  statuses.status,
  statuses.visibility,
  followed.user_id as followed_user_id,
  followed.user_name as followed_user_name,
  followed.display_name as followed_display_name,
  followed.avatar_url as followed_avatar_url
from public.user_follows follows
join public.activity_user_statuses statuses
  on statuses.user_id = follows.followed_user_id
join public.user_table followed
  on followed.user_id = follows.followed_user_id
where statuses.status in ('booked', 'tentative')
  and statuses.visibility in ('followers', 'public');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_user_name text;
begin
  requested_user_name := lower(
    regexp_replace(
      coalesce(
        nullif(new.raw_user_meta_data ->> 'user_name', ''),
        nullif(new.raw_user_meta_data ->> 'userName', ''),
        'parent'
      ),
      '[^A-Za-z0-9_.]',
      '_',
      'g'
    )
  );

  requested_user_name := left(requested_user_name, 21) || '_' || replace(left(new.id::text, 8), '-', '');

  insert into public.user_table (user_id, user_name, display_name, avatar_url)
  values (
    new.id,
    requested_user_name,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.user_table enable row level security;
alter table public.user_follows enable row level security;
alter table public.comments_table enable row level security;
alter table public.activity_swipes enable row level security;
alter table public.activity_shortlist enable row level security;
alter table public.activity_user_statuses enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_exports enable row level security;
alter table public.activity_reviews enable row level security;
alter table public.activity_photos enable row level security;

drop policy if exists "Profiles are readable" on public.user_table;
drop policy if exists "Users can create own profile" on public.user_table;
drop policy if exists "Users can update own profile" on public.user_table;

create policy "Profiles are readable"
on public.user_table
for select
using (true);

create policy "Users can create own profile"
on public.user_table
for insert
with check (auth.uid() = user_id);

create policy "Users can update own profile"
on public.user_table
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Follow relationships are readable" on public.user_follows;
drop policy if exists "Users can follow others" on public.user_follows;
drop policy if exists "Users can unfollow others" on public.user_follows;

create policy "Follow relationships are readable"
on public.user_follows
for select
using (true);

create policy "Users can follow others"
on public.user_follows
for insert
with check (auth.uid() = follower_user_id);

create policy "Users can unfollow others"
on public.user_follows
for delete
using (auth.uid() = follower_user_id);

drop policy if exists "Comments on published activities are readable" on public.comments_table;
drop policy if exists "Users can create own comments" on public.comments_table;
drop policy if exists "Users can update own comments" on public.comments_table;
drop policy if exists "Users can delete own comments" on public.comments_table;

create policy "Comments on published activities are readable"
on public.comments_table
for select
using (
  exists (
    select 1
    from public.activities
    where activities.activity_id = comments_table.activity_id
      and activities.public_listing_status = 'published'
  )
);

create policy "Users can create own comments"
on public.comments_table
for insert
with check (auth.uid() = user_id);

create policy "Users can update own comments"
on public.comments_table
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own comments"
on public.comments_table
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own swipes" on public.activity_swipes;
drop policy if exists "Users can create own swipes" on public.activity_swipes;
drop policy if exists "Users can update own swipes" on public.activity_swipes;
drop policy if exists "Users can delete own swipes" on public.activity_swipes;

create policy "Users can read own swipes"
on public.activity_swipes
for select
using (auth.uid() = user_id);

create policy "Users can create own swipes"
on public.activity_swipes
for insert
with check (auth.uid() = user_id);

create policy "Users can update own swipes"
on public.activity_swipes
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own swipes"
on public.activity_swipes
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own shortlist" on public.activity_shortlist;
drop policy if exists "Users can create own shortlist" on public.activity_shortlist;
drop policy if exists "Users can update own shortlist" on public.activity_shortlist;
drop policy if exists "Users can delete own shortlist" on public.activity_shortlist;

create policy "Users can read own shortlist"
on public.activity_shortlist
for select
using (auth.uid() = user_id);

create policy "Users can create own shortlist"
on public.activity_shortlist
for insert
with check (auth.uid() = user_id);

create policy "Users can update own shortlist"
on public.activity_shortlist
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own shortlist"
on public.activity_shortlist
for delete
using (auth.uid() = user_id);

drop policy if exists "Readable activity statuses by visibility" on public.activity_user_statuses;
drop policy if exists "Users can create own activity statuses" on public.activity_user_statuses;
drop policy if exists "Users can update own activity statuses" on public.activity_user_statuses;
drop policy if exists "Users can delete own activity statuses" on public.activity_user_statuses;

create policy "Readable activity statuses by visibility"
on public.activity_user_statuses
for select
using (
  auth.uid() = user_id
  or visibility = 'public'
  or (
    visibility = 'followers'
    and exists (
      select 1
      from public.user_follows
      where user_follows.follower_user_id = auth.uid()
        and user_follows.followed_user_id = activity_user_statuses.user_id
    )
  )
);

create policy "Users can create own activity statuses"
on public.activity_user_statuses
for insert
with check (auth.uid() = user_id);

create policy "Users can update own activity statuses"
on public.activity_user_statuses
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own activity statuses"
on public.activity_user_statuses
for delete
using (auth.uid() = user_id);

drop policy if exists "Readable calendar events by visibility" on public.calendar_events;
drop policy if exists "Users can create own calendar events" on public.calendar_events;
drop policy if exists "Users can update own calendar events" on public.calendar_events;
drop policy if exists "Users can delete own calendar events" on public.calendar_events;

create policy "Readable calendar events by visibility"
on public.calendar_events
for select
using (
  auth.uid() = user_id
  or visibility = 'public'
  or (
    visibility = 'followers'
    and exists (
      select 1
      from public.user_follows
      where user_follows.follower_user_id = auth.uid()
        and user_follows.followed_user_id = calendar_events.user_id
    )
  )
);

create policy "Users can create own calendar events"
on public.calendar_events
for insert
with check (auth.uid() = user_id);

create policy "Users can update own calendar events"
on public.calendar_events
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own calendar events"
on public.calendar_events
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own calendar exports" on public.calendar_event_exports;
drop policy if exists "Users can create own calendar exports" on public.calendar_event_exports;
drop policy if exists "Users can update own calendar exports" on public.calendar_event_exports;
drop policy if exists "Users can delete own calendar exports" on public.calendar_event_exports;

create policy "Users can read own calendar exports"
on public.calendar_event_exports
for select
using (auth.uid() = user_id);

create policy "Users can create own calendar exports"
on public.calendar_event_exports
for insert
with check (auth.uid() = user_id);

create policy "Users can update own calendar exports"
on public.calendar_event_exports
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own calendar exports"
on public.calendar_event_exports
for delete
using (auth.uid() = user_id);

drop policy if exists "Activity reviews are readable" on public.activity_reviews;
drop policy if exists "Users can create own reviews" on public.activity_reviews;
drop policy if exists "Users can update own reviews" on public.activity_reviews;
drop policy if exists "Users can delete own reviews" on public.activity_reviews;

create policy "Activity reviews are readable"
on public.activity_reviews
for select
using (true);

create policy "Users can create own reviews"
on public.activity_reviews
for insert
with check (auth.uid() = user_id);

create policy "Users can update own reviews"
on public.activity_reviews
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own reviews"
on public.activity_reviews
for delete
using (auth.uid() = user_id);

drop policy if exists "Activity photos are readable" on public.activity_photos;
drop policy if exists "Users can add own photos" on public.activity_photos;
drop policy if exists "Users can update own photos" on public.activity_photos;
drop policy if exists "Users can delete own photos" on public.activity_photos;

create policy "Activity photos are readable"
on public.activity_photos
for select
using (true);

create policy "Users can add own photos"
on public.activity_photos
for insert
with check (auth.uid() = user_id);

create policy "Users can update own photos"
on public.activity_photos
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own photos"
on public.activity_photos
for delete
using (auth.uid() = user_id);
