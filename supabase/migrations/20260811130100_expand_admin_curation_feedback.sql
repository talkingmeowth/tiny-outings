-- Capture the complete set of administrator corrections made during draft
-- review, so importer improvements have an auditable feedback trail.
create or replace function public.record_admin_activity_curation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_values jsonb;
  updated_values jsonb;
begin
  if not public.is_tiny_outings_admin() then
    return new;
  end if;

  previous_values := jsonb_build_object(
    'activity_name', old.activity_name,
    'address', old.address,
    'borough', old.borough,
    'category', old.category,
    'start_time', old.start_time,
    'end_time', old.end_time,
    'description', old.description,
    'cost', old.cost,
    'age_suitability', old.age_suitability,
    'admin_cover_image_url', old.admin_cover_image_url,
    'user_image_url', old.user_image_url,
    'website', old.website,
    'organiser_website', old.organiser_website,
    'google_link', old.google_link,
    'google_place_uri', old.google_place_uri
  );
  updated_values := jsonb_build_object(
    'activity_name', new.activity_name,
    'address', new.address,
    'borough', new.borough,
    'category', new.category,
    'start_time', new.start_time,
    'end_time', new.end_time,
    'description', new.description,
    'cost', new.cost,
    'age_suitability', new.age_suitability,
    'admin_cover_image_url', new.admin_cover_image_url,
    'user_image_url', new.user_image_url,
    'website', new.website,
    'organiser_website', new.organiser_website,
    'google_link', new.google_link,
    'google_place_uri', new.google_place_uri
  );

  if previous_values is distinct from updated_values then
    insert into public.activity_curation_feedback (
      activity_id,
      admin_user_id,
      data_source,
      previous_values,
      updated_values
    ) values (
      new.activity_id,
      auth.uid(),
      new.data_source,
      previous_values,
      updated_values
    );
  end if;

  return new;
end;
$$;
