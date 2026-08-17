-- Split generic family and stay-and-play listings using the activity title and
-- description. Specific venue categories remain authoritative; only broad
-- buckets are refined into the more useful Plan labels.
create or replace function public.canonical_activity_category(
  p_category text,
  p_data_source text,
  p_source_name text,
  p_activity_name text,
  p_description text
)
returns text
language plpgsql
immutable
as $$
declare
  normalized_category text := lower(btrim(coalesce(p_category, '')));
  normalized_source text := lower(concat_ws(' ', coalesce(p_data_source, ''), coalesce(p_source_name, '')));
  content text := lower(concat_ws(' ', coalesce(p_activity_name, ''), coalesce(p_description, '')));
  base_category text;
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
    when 'museums & culture' then return 'Museums & culture';
    when 'museum' then return 'Museums & culture';
    when 'child friendly museum' then return 'Museums & culture';
    when 'bookshops' then return 'Bookshops';
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
    when 'events' then return 'Events';
    when 'stay & play' then base_category := 'Stay & play';
    when 'family hubs' then base_category := 'Stay & play';
    when 'family hub' then base_category := 'Stay & play';
    when 'parent-and-baby playgroups' then base_category := 'Stay & play';
    when 'baby stay and play' then base_category := 'Stay & play';
    when 'family activities' then base_category := 'Family activities';
    when 'family activity' then base_category := 'Family activities';
    when 'baby & toddler cinema' then base_category := 'Family activities';
    when 'parent meet-ups' then base_category := 'Family activities';
    else return nullif(btrim(p_category), '');
  end case;

  if content ~ '\m(swim|swimming|water babies|puddle ducks)\M' then return 'Baby swim'; end if;
  if content ~ '\m(play cafe|soft play|indoor play|playroom)\M' then return 'Play cafes'; end if;
  if content ~ '\m(cafe|coffee|bakery|restaurant|brasserie|bistro|lunch)\M' then return 'Cafes & food'; end if;
  if content ~ '\m(park|playground|garden|open space|nature reserve|recreation ground)\M' then return 'Parks & outdoor play'; end if;
  if content ~ '\m(bookshop|book shop|bookstore|book store)\M' then return 'Bookshops'; end if;
  if content ~ '\m(museum|culture|gallery|historic house)\M' then return 'Museums & culture'; end if;
  if content ~ '\m(dance|ballet|yoga|barre|fitness|massage|postnatal|pregnancy|judo|martial arts|movement|feeding|breastfeeding|bottle feeding)\M' then return 'Movement & wellbeing'; end if;
  if content ~ '\m(pub quiz|parent meet-up|parent meetup|family day)\M' then return 'Family activities'; end if;
  if content ~ '\m(stay and play|stay & play|playgroup|tots and toys|family hub|parent and baby)\M' then return 'Stay & play'; end if;
  if content ~ '\m(sensory|story|rhyme|music|singing|signing|drama|craft|art class|adventure babies|class|club)\M' then return 'Classes & clubs'; end if;

  return base_category;
end;
$$;

create or replace function public.set_activity_plan_filters()
returns trigger
language plpgsql
as $$
begin
  new.category := coalesce(
    public.canonical_activity_category(
      new.category,
      new.data_source,
      new.source_name,
      new.activity_name,
      new.description
    ),
    'Family activities'
  );
  new.plan_filters := public.activity_plan_filters(new.category, new.data_source, new.source_name);
  return new;
end;
$$;

update public.activities
set
  category = coalesce(
    public.canonical_activity_category(category, data_source, source_name, activity_name, description),
    'Family activities'
  ),
  plan_filters = public.activity_plan_filters(category, data_source, source_name),
  updated_at = now()
where coalesce(archive, false) = false
  and public_listing_status = 'published'
  and category is distinct from public.canonical_activity_category(category, data_source, source_name, activity_name, description);
