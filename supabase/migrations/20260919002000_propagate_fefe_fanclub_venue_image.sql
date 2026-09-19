-- All active FE FE FANCLUB sessions at the same Islington venue can use the
-- reviewer-approved image of that venue's play space. This official rendering
-- is more representative than the previously approved logo-only image for
-- short-term childcare, and safer than an unrelated third-party play space.
-- The canonical approval helper preserves displaced approvals in history.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_fefe_fanclub(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_fefe_fanclub;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'fefefanclub.co.uk'
      and upper(btrim(coalesce(a.activity_name, ''))) ~ '^FE FE FANCLUB '
      and upper(btrim(coalesce(a.address, ''))) =
        'UNIT 1, 6F ESTHER ANNE PL, ISLINGTON SQUARE, LONDON N1 1WL'
      then 'fefe_fanclub_islington'
    else public.image_review_approved_programme_family_pre_fefe_fanclub(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_fefe_fanclub(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_fefe_fanclub;
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
    when public.image_review_approved_programme_family(a) = 'fefe_fanclub_islington' then
      public.image_review_url_host(p_image->>'source_page_url') = 'fefefanclub.co.uk'
      and public.image_review_url_host(p_image->>'image_url') = 'images.squarespace-cdn.com'
      and p_image->>'image_url' =
        'https://images.squarespace-cdn.com/content/v1/67542d0aaa6dbf55bd7b846d/1741698851916-W6M1KGA6NKLEDRBO91UZ/Render%2B1.jpg'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 2000 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1000 else false end
    else public.image_review_approved_programme_photo_transferable_pre_fefe_fanclub(a, p_image)
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
  where proposal.activity_id = '060a8986-94b7-4142-9b92-7d856d256448'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'fefe_fanclub_islington'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
