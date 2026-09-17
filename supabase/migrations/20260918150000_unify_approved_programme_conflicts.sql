-- A fresh human approval becomes the one review photo for a verified
-- programme group. Prior approved choices are retained in an audit table.
create table if not exists public.activity_image_group_choice_history (
  history_id bigint generated always as identity primary key,
  batch_id text not null,
  activity_id uuid not null,
  group_key text not null,
  source_activity_id uuid not null,
  previous_image jsonb not null,
  previous_reviewer uuid,
  previous_reviewed_at timestamptz,
  replacement_image jsonb not null,
  replacement_reviewer uuid,
  changed_at timestamptz not null default now()
);
create index if not exists activity_image_group_choice_history_activity_idx
  on public.activity_image_group_choice_history (batch_id, activity_id, changed_at desc);
alter table public.activity_image_group_choice_history enable row level security;
revoke all on public.activity_image_group_choice_history from public, anon, authenticated;
grant all on public.activity_image_group_choice_history to service_role;

create or replace function public.image_review_canonical_group(a public.activities)
returns text
language sql immutable
as $$
  select coalesce(
    public.image_review_brand_family(a),
    public.image_review_approved_programme_family(a),
    case
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

-- Reuse the validation and pending-only propagation of earlier migrations.
do $$
begin
  if to_regprocedure('public.approve_model_image_across_sessions_programme_base(text,uuid,text,jsonb,uuid)') is null then
    alter function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid)
      rename to approve_model_image_across_sessions_programme_base;
  end if;
end;
$$;

revoke all on function public.approve_model_image_across_sessions_programme_base(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions_programme_base(text, uuid, text, jsonb, uuid) to service_role;

create or replace function public.approve_model_image_across_sessions(
  p_batch_id text,
  p_activity_id uuid,
  p_proposal_hash text,
  p_chosen_image jsonb,
  p_reviewer uuid
)
returns table(updated_activity_id uuid, approved_image jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  source_activity public.activities;
  family text;
  sibling record;
  replacement jsonb;
begin
  select * into source_activity from public.activities where activity_id = p_activity_id;
  return query select * from public.approve_model_image_across_sessions_programme_base(
    p_batch_id, p_activity_id, p_proposal_hash, p_chosen_image, p_reviewer);

  family := public.image_review_canonical_group(source_activity);
  if family is null or not public.image_review_canonical_photo_transferable(source_activity, p_chosen_image) then
    return;
  end if;

  for sibling in
    select proposal.activity_id, proposal.decision, proposal.chosen_image,
      proposal.reviewed_by, proposal.reviewed_at
    from public.activity_image_model_proposals proposal
    join public.activities activity on activity.activity_id = proposal.activity_id
    where proposal.batch_id = p_batch_id
      and proposal.activity_id <> p_activity_id
      and proposal.decision in ('pending', 'approved')
      and proposal.chosen_image->>'image_url' is distinct from p_chosen_image->>'image_url'
      and activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
      and public.image_review_canonical_group(activity) = family
    order by proposal.activity_id
    for update of proposal
  loop
    replacement := p_chosen_image || jsonb_build_object(
      'propagated_from_activity_id', p_activity_id,
      'propagated_brand_family', family);
    if sibling.decision = 'approved' and sibling.chosen_image is not null then
      insert into public.activity_image_group_choice_history (
        batch_id, activity_id, group_key, source_activity_id,
        previous_image, previous_reviewer, previous_reviewed_at,
        replacement_image, replacement_reviewer
      ) values (
        p_batch_id, sibling.activity_id, family, p_activity_id,
        sibling.chosen_image, sibling.reviewed_by, sibling.reviewed_at,
        replacement, p_reviewer
      );
    end if;
    update public.activity_image_model_proposals proposal
    set decision = 'approved', chosen_image = replacement,
      reviewed_by = p_reviewer, reviewed_at = now()
    where proposal.batch_id = p_batch_id and proposal.activity_id = sibling.activity_id;
    updated_activity_id := sibling.activity_id;
    approved_image := replacement;
    return next;
  end loop;
end;
$$;

revoke all on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.approve_model_image_across_sessions(text, uuid, text, jsonb, uuid) to service_role;

-- Choose one already-approved photo per conflicting group. The Bach to Baby
-- image is the visually checked concert scene used by four approvals; its
-- high-resolution URL shows the same photo as three lower-resolution approvals.
-- Jiggety-Jig uses the official age-specific class image, not a generic baby
-- video still. Rock 'n' Roll uses its approved provider class banner.
do $$
declare
  winner record;
begin
  for winner in
    select distinct on (public.image_review_canonical_group(activity))
      proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
      proposal.chosen_image, proposal.reviewed_by
    from public.activity_image_model_proposals proposal
    join public.activities activity on activity.activity_id = proposal.activity_id
    where activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
      and proposal.decision = 'approved'
      and (
        (public.image_review_canonical_group(activity) = 'bach_to_baby'
          and proposal.chosen_image->>'image_url' like
            'https://www.eventbrite.co.uk/e/_next/image?url=%'
          and proposal.chosen_image->>'title' ilike '%Bach to Baby%')
        or (public.image_review_canonical_group(activity) = 'monkey_music_jiggety_jig'
          and proposal.chosen_image->>'image_url' =
            'https://cdn.monkeymusic.co.uk/public/inner-page-banner__jiggety-jig.jpg')
        or (public.image_review_canonical_group(activity) = 'monkey_music_rock_n_roll'
          and proposal.chosen_image->>'image_url' like
            'https://happity-production.s3.amazonaws.com/uploads/provider/banner/407/Monkey_Music_Highbury_and_Islington_banner.png%')
      )
    order by public.image_review_canonical_group(activity),
      proposal.reviewed_at desc nulls last, proposal.activity_id
  loop
    perform public.approve_model_image_across_sessions(
      winner.batch_id, winner.activity_id, winner.proposal_hash,
      winner.chosen_image, winner.reviewed_by);
  end loop;
end;
$$;
