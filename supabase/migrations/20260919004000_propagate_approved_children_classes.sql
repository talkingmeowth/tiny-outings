-- Share visually checked class photographs only within the same provider and
-- relevant programme. Archived rows and rejected/unsure proposals stay intact.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_children_classes(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_children_classes;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'thepetiteperformers.com'
      and upper(coalesce(a.activity_name, '')) like 'PETITE PERFORMERS %'
      then 'petite_performers_dance'
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'kidslingo.co.uk'
      and upper(coalesce(a.activity_name, '')) like 'KIDSLINGO%FRENCH%'
      then 'kidslingo_french'
    when a.data_source = 'better_start_for_life'
      and lower(coalesce(a.activity_name, '')) ~ '^tambini ?s? music and rhymes'
      then 'tambini_music_and_rhymes'
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'olivekanedance.com'
      and upper(coalesce(a.activity_name, '')) like 'OLIVE KANE DANCE%BALLET%'
      then 'olive_kane_ballet'
    else public.image_review_approved_programme_family_pre_children_classes(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_children_classes(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_children_classes;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean
language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'petite_performers_dance' then
      p_image->>'image_url' =
        'https://www.thepetiteperformers.com/userfiles/image/large/erp_class_images-154.jpg'
      and public.image_review_url_host(p_image->>'source_page_url') = 'thepetiteperformers.com'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 900 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 600 else false end
    when 'kidslingo_french' then
      p_image->>'image_url' =
        'https://www.kidslingo.co.uk/wp-content/uploads/2021/10/Kidslingo_147-min-scaled.jpg'
      and public.image_review_url_host(p_image->>'source_page_url') = 'kidslingo.co.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 2000 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1500 else false end
    when 'tambini_music_and_rhymes' then
      p_image->>'image_url' =
        'https://www.walthamforest.gov.uk/sites/default/files/styles/large_3_2_2x/public/2023-09/Spare%20-%20anything%20musical%20%28Carina%29.png.webp?itok=vldgUbhr'
      and public.image_review_url_host(p_image->>'source_page_url') = 'walthamforest.gov.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1000 else false end
    when 'olive_kane_ballet' then
      p_image->>'image_url' =
        'https://happity-production.s3.amazonaws.com/uploads/company/banner/3461/Olive_Kane_Dance_banner.jpeg?v=1690394555'
      and public.image_review_url_host(p_image->>'source_page_url') = 'happity.co.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 640 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 427 else false end
    else public.image_review_approved_programme_photo_transferable_pre_children_classes(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

do $$
declare
  donor record;
  family text;
begin
  foreach family in array array[
    'petite_performers_dance', 'kidslingo_french',
    'tambini_music_and_rhymes', 'olive_kane_ballet'
  ] loop
    select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
      proposal.chosen_image, proposal.reviewed_by
    into donor
    from public.activity_image_model_proposals proposal
    join public.activities activity on activity.activity_id = proposal.activity_id
    where activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
      and proposal.decision = 'approved'
      and public.image_review_canonical_group(activity) = family
      and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
    order by proposal.reviewed_at desc nulls last
    limit 1;

    if donor.activity_id is not null then
      perform public.approve_model_image_across_sessions(
        donor.batch_id, donor.activity_id, donor.proposal_hash,
        donor.chosen_image, donor.reviewed_by);
    end if;
  end loop;
end;
$$;
