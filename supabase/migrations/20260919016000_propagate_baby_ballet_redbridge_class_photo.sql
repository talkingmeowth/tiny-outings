-- Share the newer human-approved Redbridge Ballet School pre-school class
-- photo across the same Baby Ballet Redbridge sessions. Preserve the older
-- conflicting approval in history; leave unsure and archived rows alone.
begin;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_baby_ballet_redbridge(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_baby_ballet_redbridge;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and a.category = 'Movement & wellbeing'
      and upper(btrim(coalesce(a.activity_name, ''))) = 'BABY BALLET REDBRIDGE BALLET SCHOOL'
      and coalesce(a.source_url, '') like
        'https://www.happity.co.uk/schedules/baby-ballet-redbridge-ballet-school-%'
      then 'baby_ballet_redbridge_ballet_school'
    else public.image_review_approved_programme_family_pre_baby_ballet_redbridge(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_baby_ballet_redbridge(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_baby_ballet_redbridge;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'baby_ballet_redbridge_ballet_school' then
      p_image->>'image_url' =
        'https://redbridgeballetschool.co.uk/storage/classes/01KM0H7RPW2K530P33HMZW1W1J.jpg'
      and public.image_review_url_host(p_image->>'source_page_url') = 'redbridgeballetschool.co.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1600 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1000 else false end
    else public.image_review_approved_programme_photo_transferable_pre_baby_ballet_redbridge(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

-- Retain the one different human approval before replacing it.
with donor as (
  select proposal.activity_id, proposal.chosen_image
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.decision = 'approved'
    and proposal.reviewed_by is not null
    and activity.archive = false
    and public.image_review_approved_programme_family(activity) = 'baby_ballet_redbridge_ballet_school'
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1
)
insert into public.activity_image_group_choice_history (
  batch_id, activity_id, group_key, source_activity_id,
  previous_image, previous_reviewer, previous_reviewed_at,
  replacement_image, replacement_reviewer
)
select proposal.batch_id, proposal.activity_id,
  'baby_ballet_redbridge_ballet_school', donor.activity_id,
  proposal.chosen_image, proposal.reviewed_by, proposal.reviewed_at,
  donor.chosen_image, null
from public.activity_image_model_proposals proposal
join public.activities activity on activity.activity_id = proposal.activity_id
cross join donor
where activity.archive = false
  and public.image_review_approved_programme_family(activity) = 'baby_ballet_redbridge_ballet_school'
  and proposal.decision = 'approved'
  and proposal.chosen_image->>'image_url' is distinct from donor.chosen_image->>'image_url';

with donor as (
  select proposal.activity_id, proposal.chosen_image
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.decision = 'approved'
    and proposal.reviewed_by is not null
    and activity.archive = false
    and public.image_review_approved_programme_family(activity) = 'baby_ballet_redbridge_ballet_school'
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1
)
update public.activity_image_model_proposals proposal
set decision = 'approved',
    chosen_image = donor.chosen_image || jsonb_build_object(
      'propagated_from_activity_id', donor.activity_id,
      'propagated_brand_family', 'baby_ballet_redbridge_ballet_school'),
    alternatives = coalesce(proposal.alternatives, '[]'::jsonb) || jsonb_build_array(donor.chosen_image),
    reviewed_by = null,
    reviewed_at = now()
from public.activities activity, donor
where proposal.activity_id = activity.activity_id
  and activity.archive = false
  and activity.public_listing_status in ('draft', 'published')
  and public.image_review_approved_programme_family(activity) = 'baby_ballet_redbridge_ballet_school'
  and proposal.decision in ('approved', 'rejected')
  and proposal.chosen_image->>'image_url' is distinct from donor.chosen_image->>'image_url'
  and activity.admin_cover_image_url is null
  and activity.reviewed_image_url is null
  and activity.user_image_url is null
  and activity.use_category_image is not true;

-- New importer batches inherit the established human-approved photo. A new
-- proposal never overrides a prior rejection/uncertainty on the same listing.
create or replace function public.inherit_baby_ballet_redbridge_approval()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  target_activity public.activities;
  donor record;
begin
  if new.decision <> 'pending' then return new; end if;
  select * into target_activity from public.activities where activity_id = new.activity_id;
  if not found or target_activity.archive is true
    or target_activity.public_listing_status not in ('draft', 'published')
    or public.image_review_approved_programme_family(target_activity) <> 'baby_ballet_redbridge_ballet_school'
    or target_activity.admin_cover_image_url is not null
    or target_activity.reviewed_image_url is not null
    or target_activity.user_image_url is not null
    or target_activity.use_category_image is true
    or target_activity.desktop_approved_image_url is not null then
    return new;
  end if;
  if exists (
    select 1 from public.activity_image_model_proposals previous
    where previous.activity_id = new.activity_id
      and previous.decision in ('rejected', 'unsure')
  ) then return new; end if;

  select proposal.activity_id, proposal.chosen_image into donor
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.decision = 'approved'
    and proposal.reviewed_by is not null
    and activity.archive = false
    and public.image_review_approved_programme_family(activity) = 'baby_ballet_redbridge_ballet_school'
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1;

  if donor.activity_id is null then return new; end if;
  new.decision := 'approved';
  new.chosen_image := donor.chosen_image || jsonb_build_object(
    'propagated_from_activity_id', donor.activity_id,
    'propagated_brand_family', 'baby_ballet_redbridge_ballet_school');
  new.reviewed_by := null;
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists inherit_baby_ballet_redbridge_approval on public.activity_image_model_proposals;
create trigger inherit_baby_ballet_redbridge_approval
before insert or update of decision on public.activity_image_model_proposals
for each row execute function public.inherit_baby_ballet_redbridge_approval();

revoke all on function public.inherit_baby_ballet_redbridge_approval() from public, anon, authenticated;

commit;
