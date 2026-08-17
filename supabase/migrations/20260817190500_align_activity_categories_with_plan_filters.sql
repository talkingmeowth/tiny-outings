-- Keep database categories aligned with the labels exposed in the Plan and
-- admin category selectors. Importers may keep their detailed source labels;
-- this trigger converts known values before they reach the app.
create or replace function public.canonical_activity_category(
  p_category text,
  p_data_source text,
  p_source_name text
)
returns text
language plpgsql
immutable
as $$
declare
  normalized_category text := lower(btrim(coalesce(p_category, '')));
  normalized_source text := lower(concat_ws(' ', coalesce(p_data_source, ''), coalesce(p_source_name, '')));
begin
  if normalized_source ~ '(eventbrite|fever|loopla)' then
    return 'Events';
  end if;

  case normalized_category
    when 'cafes & food' then return 'Cafes & food';
    when 'child-friendly cafes' then return 'Cafes & food';
    when 'child friendly cafe' then return 'Cafes & food';

    when 'play cafes' then return 'Play cafes';
    when 'soft play' then return 'Play cafes';
    when 'indoor play' then return 'Play cafes';

    when 'baby swim' then return 'Baby swim';
    when 'baby swimming' then return 'Baby swim';
    when 'baby swimming lessons' then return 'Baby swim';

    when 'parks & outdoor play' then return 'Parks & outdoor play';
    when 'park' then return 'Parks & outdoor play';
    when 'outdoor play' then return 'Parks & outdoor play';

    when 'stay & play' then return 'Stay & play';
    when 'family hubs' then return 'Stay & play';
    when 'family hub' then return 'Stay & play';
    when 'parent-and-baby playgroups' then return 'Stay & play';
    when 'baby stay and play' then return 'Stay & play';

    when 'classes & clubs' then return 'Classes & clubs';
    when 'music & singing' then return 'Classes & clubs';
    when 'baby sensory' then return 'Classes & clubs';
    when 'arts & crafts' then return 'Classes & clubs';
    when 'story & rhyme time' then return 'Classes & clubs';
    when 'baby signing' then return 'Classes & clubs';
    when 'developmental play' then return 'Classes & clubs';

    when 'movement & wellbeing' then return 'Movement & wellbeing';
    when 'baby dance & movement' then return 'Movement & wellbeing';
    when 'baby yoga' then return 'Movement & wellbeing';
    when 'baby massage' then return 'Movement & wellbeing';
    when 'postnatal fitness' then return 'Movement & wellbeing';
    when 'feeding & postnatal support' then return 'Movement & wellbeing';

    when 'museums & culture' then return 'Museums & culture';
    when 'museum' then return 'Museums & culture';
    when 'child friendly museum' then return 'Museums & culture';

    when 'bookshops' then return 'Bookshops';

    when 'family activities' then return 'Family activities';
    when 'family activity' then return 'Family activities';
    when 'baby & toddler cinema' then return 'Family activities';
    when 'parent meet-ups' then return 'Family activities';

    when 'events' then return 'Events';
    else return nullif(btrim(p_category), '');
  end case;
end;
$$;

create or replace function public.activity_plan_filters(
  p_category text,
  p_data_source text,
  p_source_name text
)
returns text[]
language plpgsql
immutable
as $$
declare
  canonical_category text := public.canonical_activity_category(p_category, p_data_source, p_source_name);
begin
  if canonical_category = any (array[
    'Cafes & food', 'Play cafes', 'Baby swim', 'Parks & outdoor play',
    'Stay & play', 'Classes & clubs', 'Movement & wellbeing',
    'Museums & culture', 'Bookshops', 'Family activities', 'Events'
  ]) then
    return array[canonical_category];
  end if;

  return array['Family activities'];
end;
$$;

create or replace function public.set_activity_plan_filters()
returns trigger
language plpgsql
as $$
begin
  new.category := coalesce(
    public.canonical_activity_category(new.category, new.data_source, new.source_name),
    'Family activities'
  );
  new.plan_filters := public.activity_plan_filters(new.category, new.data_source, new.source_name);
  return new;
end;
$$;

alter table public.activities
  drop constraint if exists activities_plan_filters_allowed;

update public.activities
set
  category = coalesce(
    public.canonical_activity_category(category, data_source, source_name),
    'Family activities'
  ),
  plan_filters = public.activity_plan_filters(category, data_source, source_name),
  updated_at = now()
where category is distinct from public.canonical_activity_category(category, data_source, source_name)
   or plan_filters is distinct from public.activity_plan_filters(category, data_source, source_name);

alter table public.activities
  add constraint activities_plan_filters_allowed check (
    cardinality(plan_filters) = 1
    and plan_filters <@ array[
      'Cafes & food', 'Play cafes', 'Baby swim', 'Parks & outdoor play',
      'Stay & play', 'Classes & clubs', 'Movement & wellbeing',
      'Museums & culture', 'Bookshops', 'Family activities', 'Events'
    ]::text[]
  );

comment on column public.activities.plan_filters is
  'One canonical Plan category used by the mobile app and the admin selector.';
