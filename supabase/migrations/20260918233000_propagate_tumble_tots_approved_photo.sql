-- Share the human-approved, high-resolution Tumble Tots class photo across
-- active Happity sessions. A previously marked "unsure" case stays for review.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_tumble_tots(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_tumble_tots;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and btrim(coalesce(a.activity_name, '')) ~* '^tumble[[:space:]]+tots([[:space:]]|$)'
      and (
        public.image_review_class_provider_host(a) = 'tumbletots.co.uk'
        or coalesce(a.website, '') ~* '^https://www[.]happity[.]co[.]uk/schedules/tumble-tots-'
      )
      then 'tumble_tots_classes'
    else public.image_review_approved_programme_family_pre_tumble_tots(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_tumble_tots(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_tumble_tots;
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
    when public.image_review_approved_programme_family(a) = 'tumble_tots_classes' then
      public.image_review_url_host(p_image->>'source_page_url') = 'tumbletots.com'
      and p_image->>'image_url' =
        'https://www.tumbletots.com/wp-content/uploads/2025/10/Tumble-Tots-Brand-Assets-2021-679.jpg'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1200 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 800 else false end
    else public.image_review_approved_programme_photo_transferable_pre_tumble_tots(a, p_image)
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
  where proposal.activity_id = '2891c043-3d6b-49ac-be35-a30534b66e25'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'tumble_tots_classes'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
