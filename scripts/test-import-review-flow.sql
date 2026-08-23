begin;

-- The import trigger must queue new source records for admin review while
-- retaining the coordinates required by the published-listing constraint.
insert into public.activities (
  activity_name,
  address,
  lat,
  long,
  category,
  source_name,
  source_url,
  data_source,
  public_listing_status,
  archive
) values (
  'Tiny Outings importer review test',
  '1 Test Street, London E10 1AA',
  51.560000,
  -0.010000,
  'Family activities',
  'Tiny Outings QA',
  'https://example.test/tiny-outings-import-review-test',
  'Other',
  'published',
  false
);

do $$
declare
  listing_status text;
  queue_type_value text;
  queue_status text;
begin
  select public_listing_status into listing_status
  from public.activities
  where source_url = 'https://example.test/tiny-outings-import-review-test';

  select queue_type, status into queue_type_value, queue_status
  from public.activity_review_queue
  where activity_id = (
    select activity_id from public.activities
    where source_url = 'https://example.test/tiny-outings-import-review-test'
  );

  if listing_status <> 'draft' then
    raise exception 'Expected importer listing to be a draft, got %', listing_status;
  end if;
  if queue_type_value <> 'import_new' then
    raise exception 'Expected import_new review item, got %', queue_type_value;
  end if;
  if queue_status <> 'pending' then
    raise exception 'Expected pending review status, got %', queue_status;
  end if;
end $$;

rollback;
