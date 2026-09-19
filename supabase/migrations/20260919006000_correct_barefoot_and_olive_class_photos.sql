-- The old Barefoot Camden approvals were a logo and a photograph from an
-- unrelated Harrow school. Use a photo on Camden's current provider website.
-- For Olive Kane's non-ballet classes use visually verified provider photos
-- showing dance and stretching rather than the social-sharing graphic.
create temporary table verified_class_choices (
  activity_id uuid primary key,
  image_url text not null,
  source_page_url text not null,
  title text not null,
  width integer not null,
  height integer not null,
  provider text not null
) on commit drop;

insert into verified_class_choices values
  ('334ef885-6721-4341-a66e-aec0ea62a77c', 'https://bpacamden.co.uk/assets/petite-feet-jZVLnTIL.avif', 'https://bpacamden.co.uk/', 'Barefoot Camden children performing dance', 886, 862, 'barefoot_camden'),
  ('33f7c029-307c-4361-9a63-10203308b827', 'https://bpacamden.co.uk/assets/petite-feet-jZVLnTIL.avif', 'https://bpacamden.co.uk/', 'Barefoot Camden children performing dance', 886, 862, 'barefoot_camden'),
  ('7acd63d3-357b-47ec-8223-b7edb8a04daa', 'https://bpacamden.co.uk/assets/petite-feet-jZVLnTIL.avif', 'https://bpacamden.co.uk/', 'Barefoot Camden children performing dance', 886, 862, 'barefoot_camden'),
  ('1f4b1f5d-b9f2-4446-b34b-395565fa488d', 'https://bpacamden.co.uk/assets/petite-feet-jZVLnTIL.avif', 'https://bpacamden.co.uk/', 'Barefoot Camden children performing dance', 886, 862, 'barefoot_camden'),
  ('a9788bd0-8a05-47d0-ad3f-52043ee508d0', 'https://images.squarespace-cdn.com/content/v1/6967b1eff2b281172f76acc4/c66a9e95-0ddf-41ac-ae1b-8480daeff755/about+us.jpg?format=2500w', 'https://www.olivekanedance.com/', 'Olive Kane children dancing in studio', 2443, 3257, 'olive_kane_jazz'),
  ('994eb332-19e8-4a31-ad70-48994228342d', 'https://images.squarespace-cdn.com/content/v1/6967b1eff2b281172f76acc4/c66a9e95-0ddf-41ac-ae1b-8480daeff755/about+us.jpg?format=2500w', 'https://www.olivekanedance.com/', 'Olive Kane children dancing in studio', 2443, 3257, 'olive_kane_jazz'),
  ('67cb60b5-a3fc-4403-b60f-0c489f1c3b69', 'https://images.squarespace-cdn.com/content/v1/6967b1eff2b281172f76acc4/49444b6f-fa12-4736-933c-6893003e7e39/tempImagevx9AuF.jpg?format=2500w', 'https://www.olivekanedance.com/', 'Olive Kane children doing flexibility exercise', 2500, 3333, 'olive_kane_flexibility'),
  ('52629702-ad0e-46b0-b35f-04f1c222cb03', 'https://images.squarespace-cdn.com/content/v1/6967b1eff2b281172f76acc4/c66a9e95-0ddf-41ac-ae1b-8480daeff755/about+us.jpg?format=2500w', 'https://www.olivekanedance.com/', 'Olive Kane children dancing in studio', 2443, 3257, 'olive_kane_workshop');

do $$
declare
  item record;
  proposal public.activity_image_model_proposals;
  candidate jsonb;
begin
  for item in
    select choice.*, activity.activity_name
    from verified_class_choices choice
    join public.activities activity on activity.activity_id = choice.activity_id
    where activity.archive = false
      and activity.public_listing_status in ('draft', 'published')
    order by activity.activity_id
  loop
    select * into proposal from public.activity_image_model_proposals
    where activity_id = item.activity_id for update;
    if not found or proposal.decision not in ('pending', 'rejected', 'approved') then
      continue;
    end if;
    if item.provider = 'barefoot_camden' and item.activity_name not like 'BAREFOOT SCHOOL OF PERFORMING ARTS CAMDEN%' then
      continue;
    end if;
    if item.provider like 'olive_kane%' and item.activity_name not like 'OLIVE KANE DANCE%' then
      continue;
    end if;
    candidate := jsonb_build_object(
      'image_url', item.image_url,
      'source_page_url', item.source_page_url,
      'title', item.title,
      'width', item.width,
      'height', item.height,
      'source_domain', case when item.provider = 'barefoot_camden' then 'bpacamden.co.uk' else 'olivekanedance.com' end,
      'source_field', 'verified_provider_class_photo',
      'source_kind', 'organiser',
      'auto_approval_method', 'visually_checked_provider_photo'
    );
    if proposal.decision = 'approved' and proposal.chosen_image is not null
      and proposal.chosen_image->>'image_url' is distinct from item.image_url then
      insert into public.activity_image_group_choice_history (
        batch_id, activity_id, group_key, source_activity_id,
        previous_image, previous_reviewer, previous_reviewed_at,
        replacement_image, replacement_reviewer
      ) values (
        proposal.batch_id, proposal.activity_id, item.provider, item.activity_id,
        proposal.chosen_image, proposal.reviewed_by, proposal.reviewed_at,
        candidate, null
      );
    end if;
    update public.activity_image_model_proposals
    set alternatives = coalesce(alternatives, '[]'::jsonb) || jsonb_build_array(candidate)
    where batch_id = proposal.batch_id and activity_id = proposal.activity_id;
    perform public.approve_model_image_across_sessions(
      proposal.batch_id, proposal.activity_id, proposal.proposal_hash,
      candidate, null);
  end loop;
end;
$$;
