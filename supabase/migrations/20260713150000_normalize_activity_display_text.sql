-- Keep activity cards readable when imports contain emoji, HTML, curly quotes,
-- mojibake, or accented characters.
create extension if not exists unaccent with schema extensions;

create or replace function public.clean_activity_display_text(input_text text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text := coalesce(input_text, '');
begin
  cleaned := replace(cleaned, '&amp;', ' and ');
  cleaned := replace(cleaned, '&nbsp;', ' ');
  cleaned := replace(cleaned, '&quot;', ' ');
  cleaned := replace(cleaned, '&#39;', '''');
  cleaned := replace(cleaned, '&pound;', ' GBP ');
  cleaned := regexp_replace(cleaned, '<[^>]*>', ' ', 'g');
  cleaned := regexp_replace(cleaned, '&[A-Za-z0-9#]+;', ' ', 'g');
  cleaned := replace(cleaned, '&', ' and ');
  cleaned := extensions.unaccent(cleaned);
  cleaned := regexp_replace(cleaned, '[^\x20-\x7E]', ' ', 'g');
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');
  return btrim(cleaned);
end;
$$;

create or replace function public.normalize_activity_display_text()
returns trigger
language plpgsql
as $$
begin
  new.activity_name := public.clean_activity_display_text(new.activity_name);
  new.description := nullif(public.clean_activity_display_text(new.description), '');
  return new;
end;
$$;

drop trigger if exists normalize_activities_display_text on public.activities;

create trigger normalize_activities_display_text
before insert or update of activity_name, description on public.activities
for each row execute function public.normalize_activity_display_text();

update public.activities
set
  activity_name = public.clean_activity_display_text(activity_name),
  description = nullif(public.clean_activity_display_text(description), '');
