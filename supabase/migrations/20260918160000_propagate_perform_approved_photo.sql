-- PERFORM is the same provider programme across these Happity venues. Share
-- only a human-approved, provider-hosted class photo; do not touch rejected or
-- unsure proposals. The canonical approval RPC records conflicting prior
-- approvals in activity_image_group_choice_history.
create or replace function public.image_review_canonical_group(a public.activities)
returns text
language sql immutable
as $$
  select coalesce(
    public.image_review_brand_family(a),
    public.image_review_approved_programme_family(a),
    case
      when upper(btrim(coalesce(a.activity_name, ''))) = 'PERFORM'
        and a.data_source = 'Happity'
        and public.image_review_class_provider_host(a) = 'perform.org.uk'
        then 'perform_drama'
      when public.image_review_class_provider_host(a) = 'monkeymusic.co.uk'
        and a.category = 'Classes & clubs'
        and lower(regexp_replace(coalesce(a.activity_name, ''), '[^[:alnum:]]', '', 'g'))
          = 'monkeymusicjiggetyjig' then 'monkey_music_jiggety_jig'
      when public.image_review_class_provider_host(a) = 'monkeymusic.co.uk'
        and a.category = 'Classes & clubs'
        and lower(regexp_replace(coalesce(a.activity_name, ''), '[^[:alnum:]]', '', 'g'))
          = 'monkeymusicrocknroll' then 'monkey_music_rock_n_roll'
    end);
$$;

create or replace function public.image_review_canonical_photo_transferable(a public.activities, p_image jsonb)
returns boolean
language sql immutable
as $$
  select case
    when public.image_review_brand_family(a) is not null then
      public.image_review_brand_photo_transferable(a, p_image)
    when public.image_review_approved_programme_family(a) is not null then
      public.image_review_approved_programme_photo_transferable(a, p_image)
    when public.image_review_canonical_group(a) = 'perform_drama' then
      public.image_review_url_host(p_image->>'image_url') = 'perform.org.uk'
      and public.image_review_url_host(p_image->>'source_page_url') = 'perform.org.uk'
      and coalesce(p_image->>'image_url', '') !~* '(logo|icon|sprite)'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
    when public.image_review_canonical_group(a) = 'monkey_music_jiggety_jig' then
      public.image_review_url_host(p_image->>'source_page_url') = 'monkeymusic.co.uk'
      and coalesce(p_image->>'image_url', '') ~* 'jiggety[-_]?jig'
    when public.image_review_canonical_group(a) = 'monkey_music_rock_n_roll' then
      coalesce(p_image->>'image_url', '') ~* '^https://happity-production[.]s3[.]amazonaws[.]com/uploads/provider/banner/407/Monkey_Music_Highbury_and_Islington_banner[.]png'
    else false
  end;
$$;

revoke all on function public.image_review_canonical_group(public.activities) from public, anon, authenticated;
revoke all on function public.image_review_canonical_photo_transferable(public.activities, jsonb) from public, anon, authenticated;
grant execute on function public.image_review_canonical_group(public.activities) to service_role;
grant execute on function public.image_review_canonical_photo_transferable(public.activities, jsonb) to service_role;

-- The higher-resolution approved picture visibly shows children in PERFORM
-- shirts taking part in class. Use it as the single group choice. The earlier
-- competing approval remains recoverable in the choice-history table.
do $$
declare
  donor record;
begin
  select proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
    proposal.chosen_image, proposal.reviewed_by
  into donor
  from public.activity_image_model_proposals proposal
  join public.activities activity on activity.activity_id = proposal.activity_id
  where activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and public.image_review_canonical_group(activity) = 'perform_drama'
    and proposal.decision = 'approved'
    and proposal.chosen_image->>'image_url' =
      'https://www.perform.org.uk/img/library/2025/5U8A5415Perf-991-2611.jpg'
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
