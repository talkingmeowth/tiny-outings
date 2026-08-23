-- Transaction-only end-to-end QA for the account-owned app workflows.
-- It creates isolated auth identities, exercises RLS as a parent and an admin,
-- then rolls everything back so the live directory remains unchanged.

begin;

create temporary table tiny_outings_app_qa_ids (
  parent_id uuid not null,
  friend_id uuid not null,
  admin_id uuid,
  published_activity_id uuid not null,
  submitted_activity_id uuid not null
) on commit drop;

insert into tiny_outings_app_qa_ids (parent_id, friend_id, admin_id, published_activity_id, submitted_activity_id)
select
  '4a6b1b88-54ff-44e9-8bb9-100000000001'::uuid,
  '4a6b1b88-54ff-44e9-8bb9-100000000002'::uuid,
  null,
  activity_id,
  '4a6b1b88-54ff-44e9-8bb9-100000000004'::uuid
from public.activities
where public_listing_status = 'published'
  and coalesce(archive, false) = false
limit 1;

do $$
begin
  if not exists (select 1 from tiny_outings_app_qa_ids) then
    raise exception 'No published activity is available for end-to-end QA.';
  end if;
end
$$;

insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select parent_id, 'authenticated', 'authenticated', 'tinyoutings-qa-parent@example.invalid', now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('user_name', 'qa_parent', 'display_name', 'QA Parent'), now(), now()
from tiny_outings_app_qa_ids
union all
select friend_id, 'authenticated', 'authenticated', 'tinyoutings-qa-friend@example.invalid', now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('user_name', 'qa_friend', 'display_name', 'QA Friend'), now(), now()
from tiny_outings_app_qa_ids;

-- The internal admin account can already exist from a previous QA run. Reuse
-- it if so, rather than making this repeatable test depend on a fresh project.
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '4a6b1b88-54ff-44e9-8bb9-100000000003'::uuid,
  'authenticated',
  'authenticated',
  'tinyoutings-qa-admin@tinyoutings.test',
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('user_name', 'qa_admin', 'display_name', 'QA Admin'),
  now(),
  now()
where not exists (
  select 1
  from auth.users
  where email = 'tinyoutings-qa-admin@tinyoutings.test'
);

update tiny_outings_app_qa_ids
set admin_id = (
  select id
  from auth.users
  where email = 'tinyoutings-qa-admin@tinyoutings.test'
  limit 1
);

do $$
begin
  if exists (select 1 from tiny_outings_app_qa_ids where admin_id is null) then
    raise exception 'The internal QA administrator could not be resolved.';
  end if;
end
$$;

grant select on tiny_outings_app_qa_ids to authenticated;

-- Parent actions: submit an activity, save a plan, review an activity, report a
-- problem, and follow another parent. These are all executed through RLS.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', parent_id,
    'email', 'tinyoutings-qa-parent@example.invalid',
    'role', 'authenticated'
  )::text,
  true
)
from tiny_outings_app_qa_ids;
set local role authenticated;

insert into public.activities (
  activity_id, activity_name, address, lat, long, category, start_time, end_time,
  source_name, source_url, submitted_by_user_id, public_listing_status, archive
)
select
  submitted_activity_id,
  'Tiny Outings parent submission QA',
  '10 QA Lane, London E10 1AA',
  51.560000,
  -0.010000,
  'Family activities',
  '10:00',
  '11:00',
  'Website link submission',
  'https://example.test/tiny-outings-parent-submission',
  parent_id,
  'draft',
  false
from tiny_outings_app_qa_ids;

insert into public.activity_swipes (user_id, activity_id, planned_date, day_window, decision)
select parent_id, published_activity_id, current_date + 1, 'morning', 'yes'
from tiny_outings_app_qa_ids;

insert into public.activity_shortlist (user_id, activity_id, planned_date, day_window)
select parent_id, published_activity_id, current_date + 1, 'morning'
from tiny_outings_app_qa_ids;

insert into public.activity_user_statuses (user_id, activity_id, planned_date, day_window, status)
select parent_id, published_activity_id, current_date + 1, 'morning', 'tentative'
from tiny_outings_app_qa_ids;

insert into public.calendar_events (
  user_id, activity_id, planned_date, day_window, start_time, end_time, status, visibility
)
select parent_id, published_activity_id, current_date + 1, 'morning', '10:00', '11:00', 'tentative', 'followers'
from tiny_outings_app_qa_ids;

insert into public.activity_reviews (activity_id, user_id, rating, review_text)
select published_activity_id, parent_id, 5, 'QA review from the app workflow test'
from tiny_outings_app_qa_ids;

insert into public.activity_bug_reports (activity_id, reported_by_user_id, report_text)
select published_activity_id, parent_id, 'QA report from the app workflow test'
from tiny_outings_app_qa_ids;

insert into public.user_follows (follower_user_id, followed_user_id)
select parent_id, friend_id
from tiny_outings_app_qa_ids;

reset role;

-- A followed parent adds a private-by-default shared plan. It becomes visible
-- to the follower only because the follow relationship is present.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', friend_id,
    'email', 'tinyoutings-qa-friend@example.invalid',
    'role', 'authenticated'
  )::text,
  true
)
from tiny_outings_app_qa_ids;
set local role authenticated;

insert into public.calendar_events (
  user_id, activity_id, planned_date, day_window, start_time, end_time, status, visibility, title_override
)
select friend_id, published_activity_id, current_date + 2, 'afternoon', '14:00', '15:00', 'booked', 'followers', 'QA friend shared outing'
from tiny_outings_app_qa_ids;

reset role;

-- Admin actions: review the draft, publish it, resolve its queue item, then
-- archive it through the same RPC the mobile admin screen uses.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', admin_id,
    'email', 'tinyoutings-qa-admin@tinyoutings.test',
    'role', 'authenticated'
  )::text,
  true
)
from tiny_outings_app_qa_ids;
set local role authenticated;

do $$
begin
  if not public.is_tiny_outings_admin() then
    raise exception 'The QA administrator is not recognised by the admin policy.';
  end if;
  if not exists (
    select 1
    from public.activities
    where activity_id = (select submitted_activity_id from tiny_outings_app_qa_ids)
      and public_listing_status = 'draft'
  ) then
    raise exception 'The QA administrator cannot read the submitted draft.';
  end if;
end
$$;

update public.activities
set public_listing_status = 'published', archive = false
where activity_id = (select submitted_activity_id from tiny_outings_app_qa_ids);

update public.activity_review_queue
set status = 'reviewed', reviewed_at = now(), reviewed_by_user_id = auth.uid()
where activity_id = (select submitted_activity_id from tiny_outings_app_qa_ids)
  and status = 'pending';

select public.archive_tiny_outings_activity(submitted_activity_id)
from tiny_outings_app_qa_ids;

-- Archived records are intentionally not public. Switch back to the database
-- role before asserting their final state rather than relying on public RLS.
reset role;

do $$
declare
  qa tiny_outings_app_qa_ids%rowtype;
begin
  select * into qa from tiny_outings_app_qa_ids;

  if not exists (
    select 1 from public.activities
    where activity_id = qa.submitted_activity_id
      and public_listing_status = 'archived'
      and archive = true
      and archive_reason is not null
  ) then
    raise exception 'Admin archive did not set the expected archive state and reason.';
  end if;

  if not exists (
    select 1 from public.activity_review_queue
    where activity_id = qa.submitted_activity_id
      and queue_type = 'user_submission'
      and status = 'reviewed'
  ) then
    raise exception 'The submitted activity was not available to the admin review queue.';
  end if;

  if not exists (
    select 1 from public.user_table
    where user_id in (qa.parent_id, qa.friend_id, qa.admin_id)
  ) then
    raise exception 'Auth user creation did not create profile records.';
  end if;

  if not exists (
    select 1 from public.user_follows
    where follower_user_id = qa.parent_id and followed_user_id = qa.friend_id
  ) then
    raise exception 'Follow relationship was not persisted.';
  end if;

  if not exists (
    select 1 from public.calendar_events
    where user_id = qa.friend_id and title_override = 'QA friend shared outing'
  ) then
    raise exception 'Shared-week calendar event was not persisted.';
  end if;

  if not exists (
    select 1 from public.activity_reviews
    where user_id = qa.parent_id and review_text = 'QA review from the app workflow test'
  ) then
    raise exception 'Signed-in review was not persisted.';
  end if;

  if not exists (
    select 1 from public.activity_bug_reports
    where reported_by_user_id = qa.parent_id and report_text = 'QA report from the app workflow test'
  ) then
    raise exception 'Activity report was not persisted.';
  end if;
end
$$;

rollback;
