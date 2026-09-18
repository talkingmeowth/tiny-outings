-- Owner-requested automatic approval of the active Angel Swim location photos.
-- Preserve the already-approved Chelsea choice. Most proposals use the
-- provider's own matching venue image. Barnes gets an official class photo
-- from its venue page; Clapham gets a provider-owned general baby-swim photo
-- because the proposed image was explicitly labelled Putney.
do $$
declare
  item record;
  choice jsonb;
  barnes_url constant text :=
    'https://images.squarespace-cdn.com/content/v1/58e8b9e66a49638159b106bc/1673443896961-Y6JYTGPG2DROUBJKP9SC/IMG_1363.JPG';
  clapham_url constant text :=
    'https://images.squarespace-cdn.com/content/v1/58e8b9e66a49638159b106bc/1506694841779-Z6M3Z4VRONYQ2NLS2FT9/baby-image.jpg?format=2500w';
begin
  for item in
    select a.activity_id, a.activity_name, p.batch_id, p.proposal_hash,
      p.selected_image, p.alternatives, p.decision
    from public.activities a
    join public.activity_image_model_proposals p on p.activity_id = a.activity_id
    where a.archive = false
      and a.public_listing_status in ('draft', 'published')
      and a.data_source = 'Google Places'
      and a.category = 'Baby swim'
      and public.image_review_class_provider_host(a) = 'angelswim.london'
      and a.activity_name ~* '^Angel Swim (Balham|Barnes|Chelsea|Clapham|East Putney|Finchley|Hampstead|Putney|Shepherds Bush)$'
      and p.decision = 'pending'
    order by a.activity_name
  loop
    if item.activity_name = 'Angel Swim Barnes' then
      choice := jsonb_build_object(
        'image_url', barnes_url,
        'source_page_url', 'https://angelswim.london/barnes',
        'source_domain', 'angelswim.london',
        'source_field', 'website_image_candidates',
        'candidate_source', 'website',
        'source_kind', 'website',
        'title', 'Barnes — Angel Swim London baby-swim class',
        'width', 2500,
        'height', 1875,
        'model_assessed', true,
        'relevance_reason', 'Official Barnes venue-page class photograph; visually checked',
        'source_refs', jsonb_build_array(jsonb_build_object('field', 'website_image_candidates', 'index', 0))
      );

      update public.activities a
      set website_image_candidates = coalesce(a.website_image_candidates, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'link', 'https://angelswim.london/barnes',
          'title', 'Barnes — Angel Swim London baby-swim class',
          'source', 'angelswim.london',
          'original', barnes_url,
          'original_width', 2500,
          'original_height', 1875,
          'source_kind', 'website',
          'position', 1
        ))
      where a.activity_id = item.activity_id
        and not exists (
          select 1 from jsonb_array_elements(coalesce(a.website_image_candidates, '[]'::jsonb)) candidate
          where candidate->>'original' = barnes_url
        );

      update public.activity_image_model_proposals p
      set alternatives = coalesce(p.alternatives, '[]'::jsonb) || jsonb_build_array(choice),
          candidate_count = coalesce(p.candidate_count, 0) + 1,
          assessed_count = coalesce(p.assessed_count, 0) + 1
      where p.batch_id = item.batch_id and p.activity_id = item.activity_id
        and not exists (
          select 1 from jsonb_array_elements(coalesce(p.alternatives, '[]'::jsonb)) candidate
          where candidate->>'image_url' = barnes_url
        );
    elsif item.activity_name = 'Angel Swim Clapham' then
      select alternative into choice
      from jsonb_array_elements(coalesce(item.alternatives, '[]'::jsonb)) alternative
      where alternative->>'image_url' = clapham_url
        and alternative->>'source_page_url' = 'https://angelswim.london/'
        and (alternative->>'width')::integer >= 1000
        and (alternative->>'height')::integer >= 1000
      limit 1;
    else
      choice := item.selected_image;
      if choice->>'source_page_url' not like 'https://angelswim.london/%'
        or coalesce(choice->>'title', '') not ilike '%' || replace(item.activity_name, 'Angel Swim ', '') || '%'
        or (choice->>'width')::integer < 700
        or (choice->>'height')::integer < 700 then
        raise exception 'The selected Angel Swim image is not a verified venue photo: %', item.activity_name;
      end if;
    end if;

    if choice is null or nullif(choice->>'image_url', '') is null then
      raise exception 'No suitable image for %', item.activity_name;
    end if;

    perform public.approve_model_image_across_sessions(
      item.batch_id, item.activity_id, item.proposal_hash, choice, null);

    update public.activity_image_model_proposals p
    set chosen_image = p.chosen_image || jsonb_build_object(
      'approval_origin', 'owner_requested_automatic_batch',
      'approval_note', 'Angel Swim location images visually checked on 2026-09-19'
    )
    where p.batch_id = item.batch_id and p.activity_id = item.activity_id
      and p.decision = 'approved';
  end loop;
end;
$$;
