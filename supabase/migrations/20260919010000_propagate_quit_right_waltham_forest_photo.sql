-- All active Quit Right Waltham Forest sessions use the same council photo.
-- Prefer its approved 1536x1024 version over the smaller approved derivative.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_quit_right(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_quit_right;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'better_start_for_life'
      and public.image_review_url_host(a.website) = 'walthamforest.gov.uk'
      and lower(coalesce(a.activity_name, '')) ~ '^quit right( waltham forest)? at '
      then 'quit_right_waltham_forest'
    else public.image_review_approved_programme_family_pre_quit_right(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_quit_right(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_quit_right;
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
    when 'quit_right_waltham_forest' then
      p_image->>'image_url' =
        'https://www.walthamforest.gov.uk/sites/default/files/styles/large_3_2_2x/public/2024-04/Quit%20Right%20%28Bilkis%29.png.webp?itok=9K6Sk3x6'
      and public.image_review_url_host(p_image->>'source_page_url') = 'walthamforest.gov.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1000 else false end
    else public.image_review_approved_programme_photo_transferable_pre_quit_right(a, p_image)
  end;
$$;

revoke all on function public.image_review_approved_programme_family(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_approved_programme_family(public.activities) to service_role;
grant execute on function public.image_review_approved_programme_photo_transferable(public.activities, jsonb) to service_role;

do $$
declare
  item record;
  proposal public.activity_image_model_proposals;
  candidate jsonb := jsonb_build_object(
    'image_url',
      'https://www.walthamforest.gov.uk/sites/default/files/styles/large_3_2_2x/public/2024-04/Quit%20Right%20%28Bilkis%29.png.webp?itok=9K6Sk3x6',
    'source_page_url',
      'https://www.walthamforest.gov.uk/events/quit-right-waltham-forest-walthamstow-library',
    'source_domain', 'walthamforest.gov.uk',
    'source_field', 'verified_official_event_photo',
    'source_kind', 'website',
    'title', 'Quit Right Waltham Forest stop-smoking support',
    'width', 1536,
    'height', 1024,
    'auto_approval_method', 'visually_checked_council_event_photo'
  );
begin
  for item in
    select activity.activity_id
    from public.activities activity
    where activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
      and public.image_review_approved_programme_family(activity) = 'quit_right_waltham_forest'
    order by activity.activity_id
  loop
    select * into proposal
    from public.activity_image_model_proposals
    where activity_id = item.activity_id
    for update;
    if not found or proposal.decision not in ('pending', 'rejected', 'approved') then
      continue;
    end if;
    if proposal.decision = 'approved'
      and proposal.chosen_image->>'image_url' = candidate->>'image_url' then
      continue;
    end if;

    if proposal.decision = 'approved' and proposal.chosen_image is not null then
      insert into public.activity_image_group_choice_history (
        batch_id, activity_id, group_key, source_activity_id,
        previous_image, previous_reviewer, previous_reviewed_at,
        replacement_image, replacement_reviewer
      ) values (
        proposal.batch_id, proposal.activity_id, 'quit_right_waltham_forest', item.activity_id,
        proposal.chosen_image, proposal.reviewed_by, proposal.reviewed_at,
        candidate, null
      );
    end if;

    update public.activity_image_model_proposals
    set alternatives = coalesce(alternatives, '[]'::jsonb) || jsonb_build_array(candidate)
    where batch_id = proposal.batch_id and activity_id = proposal.activity_id;
    perform public.approve_model_image_across_sessions(
      proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
      candidate, null
    );
  end loop;
end;
$$;
