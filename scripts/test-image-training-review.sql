-- Integration checks use temporary rows inside a transaction. No activity or
-- real review is changed, and every test row is rolled back at the end.
begin;
do $$
declare
  aid uuid; uid uuid; before_activity jsonb; after_activity jsonb; n integer;
  ids uuid[] := array['00000000-0000-4000-8000-000000001001'::uuid,'00000000-0000-4000-8000-000000001002'::uuid,'00000000-0000-4000-8000-000000001003'::uuid];
  candidates jsonb := '[{"candidate_id":"a","image_url":"https://example.test/a.jpg"},{"candidate_id":"b","image_url":"https://example.test/b.jpg"},{"candidate_id":"c","image_url":"https://example.test/c.jpg"}]';
begin
  select activity_id,to_jsonb(a) into aid,before_activity from public.activities a where not coalesce(archive,false) limit 1;
  select id into uid from auth.users where lower(email) in ('talkingmeowth06@gmail.com','talkingmeowtho6@gmail.com','benfielden@gmail.com') limit 1;
  if uid is null or aid is null then raise exception 'QA requires an existing administrator and listing'; end if;
  if has_table_privilege('anon','public.image_training_cases','select') or has_table_privilege('authenticated','public.image_training_reviews','insert') then raise exception 'Review data is not protected'; end if;
  for n in 1..3 loop
    insert into public.image_training_batches(batch_id,title) values ('qa-training-'||n,'Transactional QA');
    insert into public.image_training_cases(case_id,batch_id,activity_id,sequence,dataset_split,evaluation_group_key,selection_reason,activity_snapshot,candidates,candidate_set_hash)
    values(ids[n],'qa-training-'||n,aid,1,(array['development','calibration','holdout'])[n],'qa-group-'||n,'QA','{"activity_name":"QA"}',candidates,'qa-hash');
    insert into public.image_training_reviews(case_id,reviewer_id,request_id,candidate_set_hash,labels,preferred_candidate_id,outcome)
    values(ids[n],uid,gen_random_uuid(),'qa-hash','[{"candidate_id":"a","label":"acceptable"},{"candidate_id":"b","label":"unsuitable","reason":"wrong_location"},{"candidate_id":"c","label":"unavailable"}]','a','selected');
  end loop;
  select count(*) into n from public.image_training_development_examples where batch_id like 'qa-training-%';
  if n <> 2 then raise exception 'Expected 2 explicit usable/negative development labels; got %', n; end if;
  select count(*) into n from public.image_training_labelled_examples where batch_id like 'qa-training-%';
  if n <> 9 then raise exception 'Expected 9 labels across all splits; got %', n; end if;
  select count(*) into n from public.image_training_case_progress where batch_id like 'qa-training-%' and review_status='completed';
  if n <> 3 then raise exception 'Progress counts did not update'; end if;
  insert into public.image_training_reviews(case_id,reviewer_id,request_id,candidate_set_hash,labels,preferred_candidate_id,outcome,submitted_at)
  values(ids[1],uid,gen_random_uuid(),'qa-hash','[{"candidate_id":"b","label":"acceptable"}]','b','selected',now()+interval '1 second');
  select count(*) into n from public.image_training_development_examples where batch_id='qa-training-1' and candidate->>'candidate_id'='b' and label='acceptable' and is_preferred;
  if n <> 1 then raise exception 'Latest revision not used'; end if;
  select count(*) into n from public.image_training_reviews where case_id=ids[1];
  if n <> 2 then raise exception 'Revision history was not retained'; end if;
  update public.image_training_cases set evaluation_group_key='qa-group-1' where case_id=ids[3];
  select count(*) into n from public.image_training_development_examples where batch_id like 'qa-training-%';
  if n <> 0 then raise exception 'Related holdout group leaked into training'; end if;
  select to_jsonb(a) into after_activity from public.activities a where activity_id=aid;
  if before_activity <> after_activity then raise exception 'Training labels changed the activity'; end if;
end $$;
select 'PASS: access control, all splits, progress, revisions, uncertainty, holdout exclusion, unchanged activity' as result;
rollback;
