begin;
do $$
declare a public.activities; admin_id uuid; revised public.activities; before_logs integer;
begin
  select * into a from public.activities where not archive and public_listing_status='draft' and coalesce(admin_cover_image_url,'')='' limit 1;
  if a.activity_id is null then raise exception 'Test needs an active draft'; end if;
  select id into admin_id from auth.users where lower(email)='talkingmeowth06@gmail.com' and email_confirmed_at is not null;
  if admin_id is null then raise exception 'Test administrator missing'; end if;
  select count(*) into before_logs from public.activity_image_manual_reviews where activity_id=a.activity_id;
  perform public.save_manual_image_upload(a.activity_id,admin_id,'https://kgvqbokhuqaonghcukel.supabase.co/storage/v1/object/public/activity-images/reviewed/uploads/transaction-test.jpg',a.updated_at,'{"test":true}');
  select * into revised from public.activities where activity_id=a.activity_id;
  if revised.reviewed_image_model <> 'Manual upload' or revised.use_category_image or revised.model_selected_url is not null then raise exception 'Upload hierarchy failed'; end if;
  if (select count(*) from public.activity_image_manual_reviews where activity_id=a.activity_id) <> before_logs+1 then raise exception 'Missing ground truth log'; end if;
  begin
    perform public.apply_chat_image_selection(a.activity_id,revised.updated_at,repeat('a',64),'{"llm_reviewed":true}',null,null,null,null);
    raise exception 'TEST FAILED: human override accepted';
  exception when others then if sqlerrm <> 'Protected human image decision' then raise; end if; end;
  if has_function_privilege('authenticated','public.save_manual_image_upload(uuid,uuid,text,timestamptz,jsonb)','EXECUTE') then raise exception 'Public write access'; end if;
  if has_function_privilege('anon','public.apply_chat_image_selection(uuid,timestamptz,text,jsonb,text,text,text,numeric)','EXECUTE') then raise exception 'Public model apply access'; end if;
end $$;
rollback;
