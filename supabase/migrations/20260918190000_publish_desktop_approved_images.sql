begin;
-- Human approvals in the desktop model-review queue are live card images.
-- Keep them distinct from older manual selections and automatic model output.
alter table public.activities
  add column if not exists desktop_approved_image_url text,
  add column if not exists desktop_approved_image_batch_id text,
  add column if not exists desktop_approved_image_reviewed_at timestamptz;

comment on column public.activities.desktop_approved_image_url is
  'Image approved by an administrator in the desktop model-review queue. Synced from the latest human review decision; not an automatic model selection.';
comment on table public.activity_image_model_proposals is
  'Model image proposals. Only a human Approved decision is mirrored to activities.desktop_approved_image_url; Pending, Rejected and Unsure remain non-live.';

-- Do not let a user editing their own draft claim an administrator approval.
create or replace function public.guard_desktop_approved_image_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  if tg_op = 'INSERT' then
    if new.desktop_approved_image_url is not null
      or new.desktop_approved_image_batch_id is not null
      or new.desktop_approved_image_reviewed_at is not null then
      raise exception 'Desktop-approved image fields are managed by the image review queue.';
    end if;
  else
    if (
      new.desktop_approved_image_url is distinct from old.desktop_approved_image_url
      or new.desktop_approved_image_batch_id is distinct from old.desktop_approved_image_batch_id
      or new.desktop_approved_image_reviewed_at is distinct from old.desktop_approved_image_reviewed_at
    ) then
      raise exception 'Desktop-approved image fields are managed by the image review queue.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_desktop_approved_image_columns on public.activities;
create trigger guard_desktop_approved_image_columns
before insert or update on public.activities
for each row execute function public.guard_desktop_approved_image_columns();

create or replace function public.sync_desktop_approved_image(p_activity_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  latest record;
  v_review_image_url text;
begin
  -- Pending proposals do not revoke an earlier approval. The newest actual
  -- human decision wins; a later reject/unsure removes the live review image.
  select batch_id, decision, chosen_image->>'image_url' as chosen_url, reviewed_at
  into latest
  from public.activity_image_model_proposals
  where activity_id = p_activity_id
    and decision in ('approved', 'rejected', 'unsure')
  order by reviewed_at desc nulls last, created_at desc, batch_id desc
  limit 1;

  v_review_image_url := case when latest.decision = 'approved'
    and latest.chosen_url ~* '^https?://[^[:space:]]+$'
    then latest.chosen_url else null end;

  update public.activities a
  set desktop_approved_image_url = v_review_image_url,
      desktop_approved_image_batch_id = case when v_review_image_url is not null then latest.batch_id else null end,
      desktop_approved_image_reviewed_at = case when v_review_image_url is not null then latest.reviewed_at else null end
  where a.activity_id = p_activity_id
    and (
      a.desktop_approved_image_url is distinct from v_review_image_url
      or a.desktop_approved_image_batch_id is distinct from
        (case when v_review_image_url is not null then latest.batch_id else null end)
      or a.desktop_approved_image_reviewed_at is distinct from
        (case when v_review_image_url is not null then latest.reviewed_at else null end)
    );
end;
$$;

revoke all on function public.sync_desktop_approved_image(uuid) from public, anon, authenticated;
grant execute on function public.sync_desktop_approved_image(uuid) to service_role;

create or replace function public.sync_desktop_approved_image_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.decision in ('approved', 'rejected', 'unsure') then
      perform public.sync_desktop_approved_image(old.activity_id);
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.decision in ('approved', 'rejected', 'unsure') then
      perform public.sync_desktop_approved_image(new.activity_id);
    end if;
    return new;
  end if;
  if new.decision in ('approved', 'rejected', 'unsure')
    or old.decision in ('approved', 'rejected', 'unsure') then
    perform public.sync_desktop_approved_image(new.activity_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_desktop_approved_image on public.activity_image_model_proposals;
create trigger sync_desktop_approved_image
after insert or update of decision, chosen_image, reviewed_at or delete
on public.activity_image_model_proposals
for each row execute function public.sync_desktop_approved_image_trigger();

-- Publish all existing desktop approvals, including propagated approvals.
-- No automatic/Pending selection is copied, and existing manual image fields
-- are never overwritten.
do $$
declare
  item record;
begin
  for item in select distinct activity_id from public.activity_image_model_proposals loop
    perform public.sync_desktop_approved_image(item.activity_id);
  end loop;
end;
$$;
commit;
