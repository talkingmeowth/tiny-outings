-- One human-approved Kiddikicks company banner covers football sessions from
-- Nippers through LigaSoccer, including the branded summer classes. Keep the
-- existing programme rules intact, and require a verified provider and the
-- exact high-resolution company image before transferring an approval.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_kiddikicks(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_kiddikicks;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'kiddikicks.co.uk'
      and btrim(coalesce(a.activity_name, '')) ~* '^kiddikicks[[:space:]]+football([[:space:]]|$)'
      then 'kiddikicks_football'
    else public.image_review_approved_programme_family_pre_kiddikicks(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_kiddikicks(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_kiddikicks;
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
    when public.image_review_approved_programme_family(a) = 'kiddikicks_football' then
      public.image_review_url_host(p_image->>'source_page_url') = 'happity.co.uk'
      and coalesce(p_image->>'source_page_url', '') ~* '^https://www[.]happity[.]co[.]uk/schedules/kiddikicks-'
      and split_part(coalesce(p_image->>'image_url', ''), '?', 1) =
        'https://happity-production.s3.amazonaws.com/uploads/company/banner/900/Kiddikicks_Football_for_18_months_-_8_years_olds_banner.jpg'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 800 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 600 else false end
    else public.image_review_approved_programme_photo_transferable_pre_kiddikicks(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

-- The canonical approval wrapper replaces any conflicting prior approval,
-- retains its choice history, updates pending siblings, and skips archives.
do $$
declare donor record;
begin
  select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
    proposal.chosen_image, proposal.reviewed_by
  into donor
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where proposal.activity_id = '0cfa94b5-5192-47e5-8070-a174954215d5'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'kiddikicks_football'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
