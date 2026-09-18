-- Regal Ballet sessions, including the age/grade variants, use the approved
-- general provider photo. Only verified Happity listings for Regal Ballet and
-- this exact high-resolution image from its official About page qualify.
create or replace function public.image_review_approved_programme_family(a public.activities)
returns text
language sql immutable
as $$
  select case
    when a.data_source = 'Happity'
      and a.category = 'Movement & wellbeing'
      and public.image_review_class_provider_host(a) = 'regalballet.com'
      and btrim(coalesce(a.activity_name, '')) ~* '^regal[[:space:]]+ballet([[:space:]]|$)'
      and coalesce(a.activity_name, '') !~* '(party|birthday|holiday|camp)'
      then 'regal_ballet'
    when a.data_source = 'Happity'
      and coalesce(a.activity_name, '') ~* '^juniorstrikers([[:space:]]+ltd)?[[:space:]]+'
      and coalesce(a.activity_name, '') !~* '(party|birthday|holiday|camp)'
      and (
        public.image_review_class_provider_host(a) = 'juniorstrikers.co.uk'
        or coalesce(a.website, '') ~* '^https://www[.]happity[.]co[.]uk/schedules/juniorstrikers-ltd-'
      )
      then 'junior_strikers_football'
    when public.image_review_class_provider_host(a) = 'toddlersense.com'
      and coalesce(a.activity_name, '') ~* '^toddler[[:space:]]+sense([[:space:]]|$)'
      then 'toddler_sense'
    when public.image_review_class_provider_host(a) = 'soccerdays.co.uk'
      and coalesce(a.activity_name, '') ~* '^soccerdays[[:space:]]+(orange|red|yellow|purple)[[:space:]]+class$'
      then 'soccerdays_coloured_classes'
    when public.image_review_class_provider_host(a) = 'hartbeeps.com'
      and coalesce(a.activity_name, '') ~* '^hartbeeps[[:space:]]+baby[[:space:]]+beeps([[:space:]]|$)'
      then 'hartbeeps_baby_beeps'
    when public.image_review_class_provider_host(a) = 'miniathletics.com'
      and coalesce(a.activity_name, '') ~* '^mini[[:space:]]+athletics[[:space:]]+didee[[:space:]]+athletes$'
      then 'mini_athletics_didee'
    else null
  end;
$$;

create or replace function public.image_review_approved_programme_photo_transferable(
  a public.activities, p_image jsonb
)
returns boolean
language sql immutable
as $$
  select case public.image_review_approved_programme_family(a)
    when 'regal_ballet' then
      public.image_review_url_host(p_image->>'source_page_url') = 'regalballet.com'
      and coalesce(p_image->>'source_page_url', '') ~* '^https://regalballet[.]com/about-us/?$'
      and p_image->>'image_url' = 'https://regalballet.com/wp-content/uploads/2016/05/img-about-banner.jpg'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 800 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 600 else false end
    when 'junior_strikers_football' then
      public.image_review_url_host(p_image->>'source_page_url') = 'juniorstrikers.co.uk'
      and p_image->>'image_url' = 'https://juniorstrikers.co.uk/wp-content/uploads/2023/08/5.png'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 800 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 600 else false end
    when 'toddler_sense' then
      public.image_review_url_host(p_image->>'source_page_url') = 'toddlersense.com'
      and public.image_review_url_host(p_image->>'image_url') = 'toddlersense.com'
    when 'soccerdays_coloured_classes' then
      public.image_review_url_host(p_image->>'source_page_url') = 'soccerdays.co.uk'
      and case when coalesce(p_image->>'width', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'width')::integer >= 500 else false end
      and case when coalesce(p_image->>'height', '') ~ '^[0-9]{1,8}$'
        then (p_image->>'height')::integer >= 500 else false end
    when 'hartbeeps_baby_beeps' then
      coalesce(p_image->>'image_url', '') ~* '^https://happity-production[.]s3[.]amazonaws[.]com/uploads/company/banner/16/Hartbeeps_banner[.]jpg'
    when 'mini_athletics_didee' then
      coalesce(p_image->>'image_url', '') ~* '^https://happity-production[.]s3[.]amazonaws[.]com/uploads/company/banner/380/Mini_Athletics_banner[.]jpg'
    else false
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
  where proposal.activity_id = '1f6b07c9-9113-486d-806e-c34d2510be39'
    and activity.archive = false
    and activity.public_listing_status in ('draft', 'published')
    and proposal.decision = 'approved'
    and public.image_review_canonical_group(activity) = 'regal_ballet'
    and public.image_review_canonical_photo_transferable(activity, proposal.chosen_image)
  limit 1;

  if donor.activity_id is not null then
    perform public.approve_model_image_across_sessions(
      donor.batch_id, donor.activity_id, donor.proposal_hash,
      donor.chosen_image, donor.reviewed_by);
  end if;
end;
$$;
