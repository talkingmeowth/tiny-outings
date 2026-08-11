-- Recreate the feedback trigger so draft-review edits to core listing fields
-- are recorded alongside URL and image corrections.
do $$
begin
  drop trigger if exists record_admin_activity_curation on public.activities;
  create trigger record_admin_activity_curation
  after update of activity_name, address, borough, category, start_time, end_time,
    description, cost, age_suitability, admin_cover_image_url, user_image_url,
    website, organiser_website, google_link, google_place_uri
  on public.activities
  for each row
  execute function public.record_admin_activity_curation();
end;
$$;
