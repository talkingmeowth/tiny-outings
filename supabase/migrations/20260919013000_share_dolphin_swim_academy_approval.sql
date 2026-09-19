-- A human approved the official Dolphin Swim Academy baby-lesson photo for
-- Mitcham. Reuse only that approved class photo for the same provider's baby
-- swim listings at other locations; preserve admin and manual image choices.
begin;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_dolphin_swim_academy(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_dolphin_swim_academy;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text language sql immutable
as $$
  select case
    when public.image_review_class_provider_host(a) = 'dolphinswimacademy.co.uk'
      and a.category = 'Baby swim'
      and lower(coalesce(a.activity_name, '')) ~ '^dolphin swim academy([[:space:]-]|$)'
      then 'dolphin_swim_academy_baby_swim'
    else public.image_review_approved_programme_family_pre_dolphin_swim_academy(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_dolphin_swim_academy(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_dolphin_swim_academy;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'dolphin_swim_academy_baby_swim' then
      p_image->>'image_url' =
        'https://dolphinswimacademy.co.uk/wp-content/uploads/2023/01/Dolphin-Swim-181_1536x2048-768x1024.jpg'
      and public.image_review_url_host(p_image->>'source_page_url') = 'dolphinswimacademy.co.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 700 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 900 else false end
    else public.image_review_approved_programme_photo_transferable_pre_dolphin_swim_academy(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

-- A later importer can create a fresh proposal batch. Inherit the existing
-- human approval even across batches, but never override a prior rejection,
-- an admin cover, a manual review image, or a non-pending decision.
create or replace function public.inherit_dolphin_swim_academy_approval()
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
    or public.image_review_approved_programme_family(target_activity) <> 'dolphin_swim_academy_baby_swim'
    or target_activity.admin_cover_image_url is not null
    or target_activity.reviewed_image_url is not null
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
    and activity.archive is false
    and public.image_review_approved_programme_family(activity) = 'dolphin_swim_academy_baby_swim'
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1;

  if donor.activity_id is null then return new; end if;
  new.decision := 'approved';
  new.chosen_image := donor.chosen_image || jsonb_build_object(
    'propagated_from_activity_id', donor.activity_id,
    'propagated_brand_family', 'dolphin_swim_academy_baby_swim');
  new.reviewed_by := null;
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists inherit_dolphin_swim_academy_approval on public.activity_image_model_proposals;
create trigger inherit_dolphin_swim_academy_approval
before insert or update of decision on public.activity_image_model_proposals
for each row execute function public.inherit_dolphin_swim_academy_approval();

revoke all on function public.inherit_dolphin_swim_academy_approval() from public, anon, authenticated;

-- Existing pending proposals (if any) are updated with the same rules.
update public.activity_image_model_proposals proposal
set decision = 'pending'
from public.activities activity
where proposal.activity_id = activity.activity_id
  and proposal.decision = 'pending'
  and public.image_review_approved_programme_family(activity) = 'dolphin_swim_academy_baby_swim';

commit;
