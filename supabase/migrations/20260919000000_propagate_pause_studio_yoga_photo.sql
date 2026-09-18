-- The approved Pause Studio photo depicts yoga in the studio. Share it only
-- across its pregnancy/postnatal yoga sessions, not Reformer Pilates.
do $$
begin
  if to_regprocedure('public.image_review_approved_programme_family_pre_pause_studio(public.activities)') is null then
    alter function public.image_review_approved_programme_family(public.activities)
      rename to image_review_approved_programme_family_pre_pause_studio;
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
      and public.image_review_class_provider_host(a) = 'pausestudio.co.uk'
      and upper(btrim(coalesce(a.activity_name, ''))) in (
        'PAUSE YOGA STUDIO PREGNANCY YOGA',
        'PAUSE YOGA STUDIO POSTNATAL YOGA WITH YOUR BABY'
      )
      then 'pause_studio_yoga'
    else public.image_review_approved_programme_family_pre_pause_studio(a)
  end;
$$;

do $$
begin
  if to_regprocedure('public.image_review_approved_programme_photo_transferable_pre_pause_studio(public.activities,jsonb)') is null then
    alter function public.image_review_approved_programme_photo_transferable(public.activities, jsonb)
      rename to image_review_approved_programme_photo_transferable_pre_pause_studio;
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
    when public.image_review_approved_programme_family(a) = 'pause_studio_yoga' then
      public.image_review_url_host(p_image->>'source_page_url') = 'pausestudio.co.uk'
      and public.image_review_url_host(p_image->>'image_url') = 'images.squarespace-cdn.com'
      and p_image->>'image_url' =
        'https://images.squarespace-cdn.com/content/v1/6760751edd82656e7fcaf59a/50896ad1-ff98-4775-90a2-77b9d6c2abdc/High+Road_+Pause+5+starts-5255.jpg?format=2500w'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 1200 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 800 else false end
    else public.image_review_approved_programme_photo_transferable_pre_pause_studio(a, p_image)
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
  where proposal.activity_id = '2bd2678e-2701-4b49-80dc-a1ef30a43dc1'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'pause_studio_yoga'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
