-- Reuse the existing human-approved Lyric Dance photos by programme. The
-- toddler/young-ballet photo is not suitable for older graded ballet, and the
-- performing-arts banner is not used for ballet. An unsure decision stays unsure.
begin;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_lyric_stage(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_lyric_stage;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and a.category = 'Movement & wellbeing'
      and public.image_review_class_provider_host(a) = 'lyricdance.com'
      and upper(btrim(coalesce(a.activity_name, ''))) in (
        'LYRIC DANCE AND PERFORMING ARTS SCHOOL BABY BALLET',
        'LYRIC DANCE AND PERFORMING ARTS SCHOOL BUDDING BALLERINAS',
        'LYRIC DANCE AND PERFORMING ARTS SCHOOL PREPARATORY BALLET',
        'LYRIC DANCE AND PERFORMING ARTS SCHOOL TWINKLE TOTS DANCE CLASS'
      ) then 'lyric_dance_young_ballet'
    else public.image_review_approved_programme_family_pre_lyric_stage(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_lyric_stage(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_lyric_stage;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'lyric_dance_young_ballet' then
      p_image->>'image_url' =
        'https://lyricdance.com/wp-content/uploads/2023/09/Lyric-Dance-School-Teacher-and-little-ballerina-4.jpg'
      and public.image_review_url_host(p_image->>'source_page_url') = 'lyricdance.com'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1000 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 600 else false end
    when 'lyric_dance_lyric_dance_and_performing_arts_school_performing_arts_classes' then
      (
        p_image->>'image_url' =
          'https://happity-production.s3.amazonaws.com/uploads/company/banner/8245/Lyric_Dance_and_Performing_Arts_School_banner.jpg?v=1693445553'
        and public.image_review_url_host(p_image->>'source_page_url') = 'happity.co.uk'
        and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
          then (p_image->>'width')::integer >= 2000 else false end
        and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
          then (p_image->>'height')::integer >= 1000 else false end
      ) or public.image_review_approved_programme_photo_transferable_pre_lyric_stage(a, p_image)
    else public.image_review_approved_programme_photo_transferable_pre_lyric_stage(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

with donors as (
  select distinct on (public.image_review_approved_programme_family(activity))
    public.image_review_approved_programme_family(activity) as family,
    proposal.activity_id, proposal.chosen_image
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where activity.archive = false
    and proposal.decision = 'approved'
    and proposal.reviewed_by is not null
    and public.image_review_approved_programme_family(activity) in (
      'lyric_dance_young_ballet',
      'lyric_dance_lyric_dance_and_performing_arts_school_performing_arts_classes'
    )
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by public.image_review_approved_programme_family(activity),
    proposal.reviewed_at desc nulls last, proposal.activity_id
)
update public.activity_image_model_proposals proposal
set decision = 'approved',
    chosen_image = donor.chosen_image || jsonb_build_object(
      'propagated_from_activity_id', donor.activity_id,
      'propagated_brand_family', donor.family),
    alternatives = coalesce(proposal.alternatives, '[]'::jsonb) || jsonb_build_array(donor.chosen_image),
    reviewed_by = null,
    reviewed_at = now()
from public.activities activity, donors donor
where proposal.activity_id = activity.activity_id
  and activity.archive = false
  and activity.public_listing_status in ('draft', 'published')
  and proposal.decision = 'pending'
  and public.image_review_approved_programme_family(activity) = donor.family
  and activity.admin_cover_image_url is null
  and activity.reviewed_image_url is null
  and activity.user_image_url is null
  and activity.use_category_image is not true
  and activity.desktop_approved_image_url is null;

-- Future importer batches can inherit a human-approved photo in the same
-- programme, but explicit manual, unsure and rejected choices remain intact.
create or replace function public.inherit_lyric_dance_approval()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  target_activity public.activities;
  target_family text;
  donor record;
begin
  if new.decision <> 'pending' then return new; end if;
  select * into target_activity from public.activities where activity_id = new.activity_id;
  if not found or target_activity.archive is true
    or target_activity.public_listing_status not in ('draft', 'published')
    or target_activity.admin_cover_image_url is not null
    or target_activity.reviewed_image_url is not null
    or target_activity.user_image_url is not null
    or target_activity.use_category_image is true
    or target_activity.desktop_approved_image_url is not null then
    return new;
  end if;
  target_family := public.image_review_approved_programme_family(target_activity);
  if target_family is null or left(target_family, 12) <> 'lyric_dance_' then return new; end if;
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
    and public.image_review_approved_programme_family(activity) = target_family
    and public.image_review_approved_programme_photo_transferable(activity, proposal.chosen_image)
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1;

  if donor.activity_id is null then return new; end if;
  new.decision := 'approved';
  new.chosen_image := donor.chosen_image || jsonb_build_object(
    'propagated_from_activity_id', donor.activity_id,
    'propagated_brand_family', target_family);
  new.reviewed_by := null;
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists inherit_lyric_dance_approval on public.activity_image_model_proposals;
create trigger inherit_lyric_dance_approval
before insert or update of decision on public.activity_image_model_proposals
for each row execute function public.inherit_lyric_dance_approval();

revoke all on function public.inherit_lyric_dance_approval() from public, anon, authenticated;

commit;
