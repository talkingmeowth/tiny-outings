-- Four human approvals agree on the same Nightingale School of Dance mark.
-- This is an explicit manual-approval exception to the automated logo and
-- resolution gate (the source image is 250x113). Never use it for other schools.
begin;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_nightingale(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_nightingale;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and lower(coalesce(a.activity_name, '')) ~ '^nightingale school of dance([[:space:]]|$)'
      and coalesce(a.source_url, '') like
        'https://www.happity.co.uk/schedules/nightingale-school-of-dance-%'
      then 'nightingale_school_of_dance'
    else public.image_review_approved_programme_family_pre_nightingale(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_nightingale(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_nightingale;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'nightingale_school_of_dance' then
      p_image->>'image_url' =
        'https://happity-production.s3.amazonaws.com/uploads/company/logo/1378/event_Nightingale_School_of_Dance_logo.jpg?v=1681402833'
      and public.image_review_url_host(p_image->>'source_page_url') = 'happity.co.uk'
    else public.image_review_approved_programme_photo_transferable_pre_nightingale(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

-- Propagate the most recent human-approved choice to all active, unreviewed
-- or rejected Nightingale proposals. The earlier rejection concerned each
-- listing's old proposal, not this separately approved school image.
with donor as (
  select proposal.activity_id, proposal.chosen_image
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.decision = 'approved'
    and proposal.reviewed_by is not null
    and activity.archive = false
    and public.image_review_approved_programme_family(activity) = 'nightingale_school_of_dance'
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1
)
update public.activity_image_model_proposals proposal
set decision = 'approved',
    chosen_image = donor.chosen_image || jsonb_build_object(
      'propagated_from_activity_id', donor.activity_id,
      'propagated_brand_family', 'nightingale_school_of_dance'),
    alternatives = coalesce(proposal.alternatives, '[]'::jsonb) || jsonb_build_array(donor.chosen_image),
    reviewed_by = null,
    reviewed_at = now()
from public.activities activity, donor
where proposal.activity_id = activity.activity_id
  and activity.archive = false
  and activity.public_listing_status in ('draft', 'published')
  and public.image_review_approved_programme_family(activity) = 'nightingale_school_of_dance'
  and proposal.decision in ('pending', 'rejected')
  and activity.admin_cover_image_url is null
  and activity.reviewed_image_url is null
  and activity.user_image_url is null
  and activity.use_category_image is not true
  and activity.desktop_approved_image_url is null;

-- New importer batches inherit the established human-approved choice, but
-- past explicit rejections/uncertainty for that same listing stay untouched.
create or replace function public.inherit_nightingale_school_of_dance_approval()
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
    or public.image_review_approved_programme_family(target_activity) <> 'nightingale_school_of_dance'
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
    and public.image_review_approved_programme_family(activity) = 'nightingale_school_of_dance'
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1;

  if donor.activity_id is null then return new; end if;
  new.decision := 'approved';
  new.chosen_image := donor.chosen_image || jsonb_build_object(
    'propagated_from_activity_id', donor.activity_id,
    'propagated_brand_family', 'nightingale_school_of_dance');
  new.reviewed_by := null;
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists inherit_nightingale_school_of_dance_approval
  on public.activity_image_model_proposals;
create trigger inherit_nightingale_school_of_dance_approval
before insert or update of decision on public.activity_image_model_proposals
for each row execute function public.inherit_nightingale_school_of_dance_approval();

revoke all on function public.inherit_nightingale_school_of_dance_approval() from public, anon, authenticated;

commit;
