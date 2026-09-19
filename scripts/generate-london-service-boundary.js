import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GLA's official Greater London Boundary (layer 303), simplified to roughly
// 10 metres. This is a one-off, checked-in snapshot: imports never fetch it.
const source = 'https://gis.london.gov.uk/arcgis/rest/services/apps/planning_data_map_02/MapServer/303/query';
const parameters = new URLSearchParams({
  where: '1=1',
  outFields: 'name',
  returnGeometry: 'true',
  outSR: '4326',
  geometryPrecision: '5',
  maxAllowableOffset: '0.0001',
  f: 'geojson',
});
const response = await fetch(`${source}?${parameters}`);
if (!response.ok) throw new Error(`GLA boundary download failed: ${response.status}`);
const collection = await response.json();
const geometry = collection.features?.[0]?.geometry;
if (collection.features?.length !== 1 || !['Polygon', 'MultiPolygon'].includes(geometry?.type)) {
  throw new Error('Expected one Greater London polygon from the GLA.');
}
const geojson = JSON.stringify(geometry);
if (geojson.length < 10000 || geojson.length > 150000) throw new Error('Unexpected boundary geometry size.');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
writeFileSync(join(root, 'data', 'greater-london-boundary.generated.geojson'), `${geojson}\n`);
const migration = join(root, 'supabase', 'migrations', '20260919012000_enforce_london_service_area.sql');
const sql = `-- Boundary source: Greater London Authority, Greater London Boundary layer 303.
-- https://gis.london.gov.uk/arcgis/rest/services/apps/planning_data_map_02/MapServer/303
-- Contains public sector information licensed under the Open Government Licence v3.0.
-- Simplified to approximately 10 metres; a 20-metre border tolerance avoids
-- false exclusions from simplified geometry or imprecise venue coordinates.
begin;

create table if not exists public.london_service_boundary (
  boundary_key text primary key,
  boundary_geom extensions.geometry(MultiPolygon, 4326) not null
);

insert into public.london_service_boundary (boundary_key, boundary_geom)
values ('greater_london', extensions.ST_Multi(extensions.ST_GeomFromGeoJSON('${geojson}')))
on conflict (boundary_key) do update set boundary_geom = excluded.boundary_geom;

revoke all on public.london_service_boundary from anon, authenticated;

create or replace function public.enforce_london_activity_location()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  london_geom extensions.geometry;
  venue_point extensions.geometry;
begin
  -- A source name, city label or borough string is not proof of location.
  -- Listings without coordinates stay in draft until verified.
  if new.lat is null or new.long is null then
    if new.archive is not true and new.public_listing_status = 'published' then
      new.public_listing_status := 'draft';
    end if;
    return new;
  end if;

  select boundary_geom into london_geom
  from public.london_service_boundary where boundary_key = 'greater_london';
  if london_geom is null then raise exception 'Greater London service boundary is missing'; end if;
  venue_point := extensions.ST_SetSRID(extensions.ST_MakePoint(new.long, new.lat), 4326);

  if not extensions.ST_DWithin(venue_point::extensions.geography, london_geom::extensions.geography, 20) then
    if new.archive is not true and new.public_listing_status in ('published', 'draft') then
      new.archive_previous_listing_status := new.public_listing_status;
    end if;
    new.archive := true;
    new.public_listing_status := 'archived';
    new.archive_reason := 'Outside Greater London service area';
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists zz_enforce_london_activity_location on public.activities;
create trigger zz_enforce_london_activity_location
before insert or update of activity_name, address, postcode, lat, long, archive, public_listing_status
on public.activities for each row execute function public.enforce_london_activity_location();

-- Apply the same guard to already-imported published and draft records.
update public.activities
set lat = lat, updated_at = now()
where archive is not true and lat is not null and long is not null
  and not extensions.ST_DWithin(
    extensions.ST_SetSRID(extensions.ST_MakePoint(long, lat), 4326)::extensions.geography,
    (select boundary_geom::extensions.geography from public.london_service_boundary where boundary_key = 'greater_london'),
    20
  );

commit;
`;
writeFileSync(migration, sql);
console.log(`Generated ${migration} from GLA layer 303 (${geojson.length} bytes).`);
