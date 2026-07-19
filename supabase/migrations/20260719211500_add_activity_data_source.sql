alter table public.activities
  add column if not exists data_source text;

update public.activities
set data_source = case
  when source_name = 'Happity' then 'Happity'
  when source_name like 'Google Places API%' then 'Google Places'
  when source_name = 'Waltham Forest Best Start in Life events' then 'Better Start for Life'
  when source_name = 'Eventbrite London baby listings' then 'Eventbrite'
  when source_name = 'Fever London family listings' then 'Fever'
  when source_name in (
    'Transition Leytonstone Green Directory',
    'Highams Park Portal'
  ) then 'Local directory'
  else 'Other'
end;

alter table public.activities
  alter column data_source set not null;

create index if not exists activities_data_source_idx
  on public.activities (data_source);
