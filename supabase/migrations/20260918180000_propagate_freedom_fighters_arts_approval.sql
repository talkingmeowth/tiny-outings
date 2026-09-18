-- A reviewer explicitly approved the same Freedom Fighters Arts brand image
-- for two sessions. Share that review decision across this verified provider's
-- activities, including the different dance and art classes. This is a
-- deliberate brand-image exception to the usual no-logo selection policy.
create or replace function public.image_review_canonical_group(a public.activities)
returns text
language sql immutable
as $$
  select coalesce(
    public.image_review_brand_family(a),
    public.image_review_approved_programme_family(a),
    case
      when a.data_source = 'Happity'
        and public.image_review_class_provider_host(a) = 'freedomfightersarts.com'
        and btrim(coalesce(a.activity_name, '')) ~* '^freedom[[:space:]]+fighters[[:space:]]+arts[[:space:]]+'
        then 'freedom_fighters_arts'
      when public.image_review_class_provider_host(a) = 'motherandmore.uk'
        and a.data_source in ('Happity', 'Other')
        and (
          btrim(coalesce(a.activity_name, '')) ~* '^mother[[:space:]]+and[[:space:]]+more[[:space:]]+baby[[:space:]]+massage[[:space:]]+course$'
          or btrim(coalesce(a.activity_name, '')) ~* '^mother[[:space:]]+and[[:space:]]+more[[:space:]]+baby[[:space:]]+massage[[:space:]]*-[[:space:]]*[^-]+$'
        )
        and coalesce(a.activity_name, '') !~* '(yoga|workshop|dads|stage)'
        then 'mother_and_more_baby_massage'
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
    when public.image_review_canonical_group(a) = 'freedom_fighters_arts' then
      public.image_review_url_host(p_image->>'source_page_url') = 'freedomfightersarts.com'
      and public.image_review_url_host(p_image->>'image_url') = 'static.wixstatic.com'
      and coalesce(p_image->>'image_url', '') like 'https://static.wixstatic.com/media/0d2d62\_%' escape '\'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
    when public.image_review_canonical_group(a) = 'mother_and_more_baby_massage' then
      public.image_review_url_host(p_image->>'source_page_url') = 'motherandmore.uk'
      and public.image_review_url_host(p_image->>'image_url') = 'static.wixstatic.com'
      and coalesce(p_image->>'image_url', '') like 'https://static.wixstatic.com/media/823bd6\_%' escape '\'
      and coalesce(p_image->>'title', '') ~* 'baby[[:space:]]+massage'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
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
    and public.image_review_canonical_group(activity) = 'freedom_fighters_arts'
    and proposal.decision = 'approved'
    and proposal.chosen_image->>'image_url' =
      'https://static.wixstatic.com/media/0d2d62_39b37afc529c42619176973b27a29799~mv2.jpg'
  order by proposal.reviewed_at desc nulls last, proposal.activity_id
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
