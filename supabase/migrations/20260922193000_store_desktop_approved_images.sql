-- An approved desktop-review image must be durable. These helpers replace the
-- selected external URL with a content-addressed activity-images URL while
-- retaining the original candidate and source metadata in chosen_image.

create or replace function public.approve_persisted_model_image_url_across_sessions(
  p_batch_id text,
  p_activity_id uuid,
  p_proposal_hash text,
  p_original_image_url text,
  p_stored_image_url text,
  p_storage_path text,
  p_width integer,
  p_height integer,
  p_mime_type text,
  p_reviewer uuid
)
returns table(updated_activity_id uuid, approved_image jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  approved record;
  persisted jsonb;
begin
  if p_stored_image_url !~* '^https?://[^[:space:]]+$'
    or nullif(btrim(p_storage_path), '') is null then
    raise exception 'The approved image was not stored safely.';
  end if;

  for approved in
    select * from public.approve_model_image_url_across_sessions(
      p_batch_id, p_activity_id, p_proposal_hash, p_original_image_url, p_reviewer
    )
  loop
    persisted := approved.approved_image || jsonb_strip_nulls(jsonb_build_object(
      'image_url', p_stored_image_url,
      'approved_original_image_url', p_original_image_url,
      'approved_storage_path', p_storage_path,
      'downloaded_width', p_width,
      'downloaded_height', p_height,
      'downloaded_mime_type', p_mime_type,
      'downloaded_at', now()
    ));

    update public.activity_image_model_proposals proposal
    set chosen_image = persisted
    where proposal.batch_id = p_batch_id
      and proposal.activity_id = approved.updated_activity_id
      and proposal.decision = 'approved';

    updated_activity_id := approved.updated_activity_id;
    approved_image := persisted;
    return next;
  end loop;
end;
$$;

revoke all on function public.approve_persisted_model_image_url_across_sessions(
  text, uuid, text, text, text, text, integer, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.approve_persisted_model_image_url_across_sessions(
  text, uuid, text, text, text, text, integer, integer, text, uuid
) to service_role;

create or replace function public.persist_approved_model_image_url(
  p_original_image_url text,
  p_stored_image_url text,
  p_storage_path text,
  p_width integer,
  p_height integer,
  p_mime_type text
)
returns table(updated_activity_id uuid)
language sql
security definer
set search_path = public
as $$
  update public.activity_image_model_proposals proposal
  set chosen_image = proposal.chosen_image || jsonb_strip_nulls(jsonb_build_object(
    'image_url', p_stored_image_url,
    'approved_original_image_url', p_original_image_url,
    'approved_storage_path', p_storage_path,
    'downloaded_width', p_width,
    'downloaded_height', p_height,
    'downloaded_mime_type', p_mime_type,
    'downloaded_at', now()
  ))
  where proposal.decision = 'approved'
    and proposal.chosen_image->>'image_url' = p_original_image_url
  returning proposal.activity_id;
$$;

revoke all on function public.persist_approved_model_image_url(
  text, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.persist_approved_model_image_url(
  text, text, text, integer, integer, text
) to service_role;
