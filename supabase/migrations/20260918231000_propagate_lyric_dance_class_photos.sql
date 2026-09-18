-- Lyric Dance runs distinct ballet and performing-arts classes. Share an
-- approved photo only between active sessions with the same class title;
-- never let an Introduction to Performing Arts photo cover ballet or tots.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_lyric_dance(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_lyric_dance;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and a.category = 'Movement & wellbeing'
      and public.image_review_class_provider_host(a) = 'lyricdance.com'
      and btrim(coalesce(a.activity_name, '')) ~* '^lyric[[:space:]]+dance[[:space:]]+and[[:space:]]+performing[[:space:]]+arts[[:space:]]+school[[:space:]]+'
      then 'lyric_dance_' || lower(regexp_replace(btrim(a.activity_name), '[^[:alnum:]]+', '_', 'g'))
    else public.image_review_approved_programme_family_pre_lyric_dance(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_lyric_dance(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_lyric_dance;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean
language sql immutable
as $$
  select case
    when left(public.image_review_approved_programme_family(a), 12) = 'lyric_dance_' then
      public.image_review_url_host(p_image->>'source_page_url') = 'lyricdance.com'
      and public.image_review_url_host(p_image->>'image_url') = 'lyricdance.com'
      and coalesce(p_image->>'image_url', '') !~* '(logo|icon|sprite)'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 600 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 400 else false end
    else public.image_review_approved_programme_photo_transferable_pre_lyric_dance(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

do $$
declare donor record;
begin
  select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
    proposal.chosen_image, proposal.reviewed_by
  into donor
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.activity_id = '276a3527-743c-42f0-a846-1e3b7a9b3c9f'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) =
      'lyric_dance_lyric_dance_and_performing_arts_school_introduction_to_performing_arts_classes'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
