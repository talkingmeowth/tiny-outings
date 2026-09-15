-- Isolated from the earlier experimental v5 migration. No historical images
-- are changed by this migration. Human upload and its evidence commit together.
create table if not exists public.activity_image_chat_reviews (
  review_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(activity_id),
  input_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(activity_id, input_hash)
);
alter table public.activity_image_chat_reviews enable row level security;
revoke all on public.activity_image_chat_reviews from anon, authenticated;
grant all on public.activity_image_chat_reviews to service_role;

create or replace function public.save_manual_image_upload(
  p_activity_id uuid, p_user_id uuid, p_image_url text, p_expected_updated_at timestamptz, p_candidate jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare a public.activities;
begin
  select * into a from public.activities where activity_id = p_activity_id for update;
  if not found or a.archive or a.public_listing_status not in ('draft','published') then raise exception 'Active listing not found'; end if;
  if a.updated_at is distinct from p_expected_updated_at then raise exception 'Listing changed. Refresh before saving.'; end if;
  if nullif(trim(a.admin_cover_image_url),'') is not null then raise exception 'An admin cover already takes priority. Open full review to change it.'; end if;
  if not exists (select 1 from auth.users where id=p_user_id and email_confirmed_at is not null
    and lower(email) in ('talkingmeowth06@gmail.com','talkingmeowtho6@gmail.com','benfielden@gmail.com')) then raise exception 'Administrator required'; end if;
  if p_image_url is null or p_image_url not like 'https://%/storage/v1/object/public/activity-images/reviewed/uploads/%' then raise exception 'Invalid upload path'; end if;
  update public.activities set reviewed_image_url=p_image_url, reviewed_image_original_url=p_image_url,
    reviewed_image_source_url=p_image_url, reviewed_image_model='Manual upload', reviewed_image_selected_at=now(),
    reviewed_image_selected_by_user_id=p_user_id, use_category_image=false,
    model_selected_url=null, model_selected_confidence=null, model_selected_at=null, model_selected_original_url=null,
    model_selected_source_url=null, model_selected_source_field=null, model_selected_reason=null,
    model_selected_model=null, model_selected_model_version=null,
    image_review_approved_at=null, image_review_approved_by_user_id=null, image_review_approved_url=null,
    image_review_approved_original_url=null, image_review_approved_source_field=null, image_review_approved_source_url=null,
    updated_at=now() where activity_id=p_activity_id;
  insert into public.activity_image_manual_reviews(activity_id,reviewed_image_url,original_image_url,source_page_url,search_query,candidate,model,selected_by_user_id)
    values(p_activity_id,p_image_url,p_image_url,p_image_url,'',p_candidate,'Manual upload',p_user_id);
end $$;
revoke all on function public.save_manual_image_upload(uuid,uuid,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.save_manual_image_upload(uuid,uuid,text,timestamptz,jsonb) to service_role;

create or replace function public.apply_chat_image_selection(
  p_activity_id uuid, p_expected_updated_at timestamptz, p_input_hash text, p_receipt jsonb,
  p_url text, p_original_url text, p_source_url text, p_confidence numeric
) returns text language plpgsql security definer set search_path=public as $$
declare a public.activities;
begin
  select * into a from public.activities where activity_id=p_activity_id for update;
  if not found or a.archive or a.public_listing_status not in ('draft','published') then raise exception 'Active listing not found'; end if;
  if a.updated_at is distinct from p_expected_updated_at then raise exception 'Listing changed since review'; end if;
  if a.use_category_image or coalesce(nullif(trim(a.admin_cover_image_url),''),nullif(trim(a.reviewed_image_url),''),nullif(trim(a.user_image_url),'')) is not null
    or exists(select 1 from public.activity_photos p where p.activity_id=a.activity_id and p.source_provider='user_upload')
    or (a.image_review_approved_at is not null and a.image_review_approved_url in (a.model_selected_url,a.reviewed_image_url,a.user_image_url,a.admin_cover_image_url))
    then raise exception 'Protected human image decision'; end if;
  if p_receipt->>'assessment_channel' is distinct from 'codex_chat' or p_receipt->>'status' is distinct from 'complete'
    or coalesce((p_receipt->>'llm_reviewed')::boolean,false) = false or p_receipt->>'input_hash' is distinct from p_input_hash
    or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
    then raise exception 'Completed chat vision receipt required'; end if;
  if p_url is not null and (p_confidence < 0.65 or p_confidence > 1 or p_confidence is null) then raise exception 'Insufficient confidence'; end if;
  insert into public.activity_image_chat_reviews(activity_id,input_hash,receipt,applied_at)
    values(p_activity_id,p_input_hash,p_receipt,now()) on conflict(activity_id,input_hash) do nothing;
  update public.activities set model_selected_url=p_url, model_selected_original_url=p_original_url,
    model_selected_source_url=p_source_url, model_selected_source_field='all_cached_sources', model_selected_confidence=p_confidence,
    model_selected_reason=p_receipt->>'reason', model_selected_model='Codex chat vision',
    model_selected_model_version='astra-cross-source-v1', model_selected_at=now(), updated_at=now()
    where activity_id=p_activity_id;
  return case when p_url is null then 'category_art' else 'photo' end;
end $$;
revoke all on function public.apply_chat_image_selection(uuid,timestamptz,text,jsonb,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.apply_chat_image_selection(uuid,timestamptz,text,jsonb,text,text,text,numeric) to service_role;
