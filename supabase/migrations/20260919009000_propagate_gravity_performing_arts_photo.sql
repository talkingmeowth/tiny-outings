-- Use a provider-owned, high-resolution photo of young children dancing in
-- Gravity Performing Arts' studio for its toddler and tots classes. The one
-- previous approval was a stage photograph of older children, so retain that
-- choice in the audit history while replacing it. Archived rows are excluded.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_gravity(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_gravity;
  end if;
end;
$$;

create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and public.image_review_class_provider_host(a) = 'gravityperformingarts.com'
      and a.category = 'Classes & clubs'
      and lower(coalesce(a.activity_name, '')) ~ '^gravity performing arts[[:space:]]+'
      then 'gravity_performing_arts_tots'
    else public.image_review_approved_programme_family_pre_gravity(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_gravity(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_gravity;
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
    when 'gravity_performing_arts_tots' then
      p_image->>'image_url' =
        'https://images.squarespace-cdn.com/content/v1/59d60ec112abd9e8327f5c8d/1535292625626-ZRA3HEHQ6KH544K05TZV/37940081_10155636399552043_4494055187836567552_n.jpg?format=2500w'
      and p_image->>'source_page_url' = 'https://gravityperformingarts.com/'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 1000 else false end
    else public.image_review_approved_programme_photo_transferable_pre_gravity(a, p_image)
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
      'https://images.squarespace-cdn.com/content/v1/59d60ec112abd9e8327f5c8d/1535292625626-ZRA3HEHQ6KH544K05TZV/37940081_10155636399552043_4494055187836567552_n.jpg?format=2500w',
    'source_page_url', 'https://gravityperformingarts.com/',
    'source_domain', 'gravityperformingarts.com',
    'source_field', 'verified_provider_class_photo',
    'source_kind', 'organiser',
    'title', 'Young children dancing in Gravity Performing Arts studio',
    'width', 1906,
    'height', 1272,
    'auto_approval_method', 'codex_visual_review_official_provider_photo'
  );
begin
  for item in
    select activity.activity_id
    from public.activities activity
    where activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
      and public.image_review_approved_programme_family(activity) = 'gravity_performing_arts_tots'
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
        proposal.batch_id, proposal.activity_id, 'gravity_performing_arts_tots', item.activity_id,
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
