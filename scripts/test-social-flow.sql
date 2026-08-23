-- Transaction-only QA for follows, profile creation, and shared weeks.
-- Run with: npx supabase db query --linked --file scripts/test-social-flow.sql
-- Nothing persists because the script always rolls back.

begin;

create temporary table tiny_outings_social_qa_ids (
  alex_id uuid not null,
  bea_id uuid not null,
  activity_id uuid not null
) on commit drop;

insert into tiny_outings_social_qa_ids (alex_id, bea_id, activity_id)
select
  '861a91ea-4d0f-49ce-a86c-8fbc9d8c00a1'::uuid,
  '861a91ea-4d0f-49ce-a86c-8fbc9d8c00b2'::uuid,
  activity_id
from public.activities
where coalesce(archive, false) = false
  and public_listing_status = 'published'
limit 1;

do $$
begin
  if not exists (select 1 from tiny_outings_social_qa_ids) then
    raise exception 'No published activity is available for the social-flow QA test.';
  end if;
end
$$;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  ids.alex_id,
  'authenticated',
  'authenticated',
  'tinyoutings-qa-alex@example.invalid',
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('user_name', 'qa_alex', 'display_name', 'QA Alex'),
  now(),
  now()
from tiny_outings_social_qa_ids ids
union all
select
  ids.bea_id,
  'authenticated',
  'authenticated',
  'tinyoutings-qa-bea@example.invalid',
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('user_name', 'qa_bea', 'display_name', 'QA Bea'),
  now(),
  now()
from tiny_outings_social_qa_ids ids;

insert into public.user_follows (follower_user_id, followed_user_id)
select alex_id, bea_id
from tiny_outings_social_qa_ids;

insert into public.calendar_events (
  user_id,
  activity_id,
  planned_date,
  day_window,
  start_time,
  end_time,
  status,
  visibility,
  title_override
)
select
  bea_id,
  activity_id,
  current_date + 1,
  'morning',
  '10:00',
  '11:00',
  'tentative',
  'followers',
  'QA shared outing'
from tiny_outings_social_qa_ids;

grant select on tiny_outings_social_qa_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', alex_id::text, true)
from tiny_outings_social_qa_ids;

select jsonb_build_object(
  'profiles_created', (select count(*) = 2 from public.user_table where user_id in (select alex_id from tiny_outings_social_qa_ids union all select bea_id from tiny_outings_social_qa_ids)),
  'follow_created', (select exists (
    select 1
    from public.user_follows follows
    join tiny_outings_social_qa_ids ids on ids.alex_id = follows.follower_user_id and ids.bea_id = follows.followed_user_id
  )),
  'follow_counts_updated', (select exists (
    select 1
    from public.user_table alex
    join tiny_outings_social_qa_ids ids on ids.alex_id = alex.user_id
    join public.user_table bea on bea.user_id = ids.bea_id
    where alex.following = 1 and bea.followers = 1
  )),
  'followers_week_visible', (select count(*) = 1 from public.calendar_events where title_override = 'QA shared outing'),
  'qr_payload', 'tinyoutings://follow/qa_bea'
) as social_flow_qa;

rollback;
