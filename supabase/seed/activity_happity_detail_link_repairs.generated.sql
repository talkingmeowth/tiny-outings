with detail_links (activity_id, detail_url, image_url) as (
  values
    ('f665a72e-2b1c-42d9-9d4d-ebfb98a7a401'::uuid, null::text, null::text),
    ('75eab9fa-6c16-41a5-bcfb-c3de66aa21a9'::uuid, null::text, null::text),
    ('23af2eb3-baf3-45f9-8b09-2609441ac24e'::uuid, null::text, null::text),
    ('dbd02590-2d80-4457-8843-962937d7fa29'::uuid, null::text, null::text),
    ('06de8cd8-86bb-4672-ade9-27c4413e146c'::uuid, null::text, null::text),
    ('253c78f9-121d-42e9-bf5d-5d2bae86b9eb'::uuid, null::text, null::text),
    ('0e9bd105-bb34-4454-970d-057b7f11b37e'::uuid, null::text, null::text),
    ('cbbc047b-c8ec-4689-836b-23138ca82217'::uuid, null::text, null::text),
    ('b4eb9f77-0856-4d42-b429-dcb81bf9f3a6'::uuid, null::text, null::text),
    ('6edd5885-e12c-460a-9fde-33e13f3af2be'::uuid, null::text, null::text),
    ('3ceca716-5786-489d-80e9-0113577357ea'::uuid, null::text, null::text),
    ('b09b3447-f54c-486f-b21d-72fafc4a422a'::uuid, null::text, null::text),
    ('a56d9947-0692-407d-9a87-a5671a6be317'::uuid, null::text, null::text),
    ('3abbd045-e176-46cc-9183-79653608143d'::uuid, null::text, null::text),
    ('23e65a31-6905-4014-9cd6-9eb813652098'::uuid, null::text, null::text),
    ('44831cb3-773a-46bb-91e7-1c449164bda9'::uuid, null::text, null::text),
    ('eedf9442-0dde-4915-8765-8d0b23ff6df3'::uuid, null::text, null::text),
    ('926209cc-91e3-408b-abf5-c49bca906b30'::uuid, null::text, null::text),
    ('d2f08095-c7aa-4f7d-bd73-f195cbc7c3b9'::uuid, null::text, null::text),
    ('b528b6d2-a8b5-41d0-9b2b-fdb07dd36b37'::uuid, null::text, null::text),
    ('fb6b4bc4-ff41-4122-b879-0b70cf3e2dd6'::uuid, null::text, null::text),
    ('d67ec564-1cf5-45de-8886-99aa2bc8e090'::uuid, null::text, null::text),
    ('0cf54a56-34f0-41a6-965c-d10a8c9ff044'::uuid, null::text, null::text),
    ('416e9a9f-dc9e-4eea-8869-4655dba6906b'::uuid, null::text, null::text),
    ('4668b711-5aa7-448a-af80-8dc7e13ed617'::uuid, null::text, null::text),
    ('e72038f0-e2b0-4185-b7ee-5751483c5d60'::uuid, null::text, null::text),
    ('6c4858ae-55ea-4bf2-b034-5200a3179993'::uuid, null::text, null::text),
    ('31a36dbd-31a1-40be-805b-19d245b23f8a'::uuid, null::text, null::text),
    ('0cae2ffa-cd7d-4477-9f7f-ed5a9c50b160'::uuid, null::text, null::text),
    ('cc1cfc66-86cd-4066-9da0-ac1f602f5d4e'::uuid, null::text, 'https://happity-production.s3.amazonaws.com/uploads/company/logo/1790/event_Singing_Mamas_logo.png?v=1692272860'::text),
    ('042fb677-f300-42bd-91fb-5fcb17cf13ea'::uuid, null::text, null::text),
    ('b7dd213e-aef6-4700-918a-49a01915b2fe'::uuid, null::text, null::text),
    ('aa9c70c1-055c-4371-9f42-6dfcc6063b00'::uuid, null::text, null::text),
    ('260a2fec-7d70-4b8d-af6a-bd4236176164'::uuid, null::text, null::text),
    ('479bd934-19c1-4d80-80e7-1c2d3171dbdb'::uuid, null::text, null::text),
    ('22dfc7d0-0bf9-41dc-b4cd-c1c9c8f72a6b'::uuid, null::text, null::text)
)
update public.activities as activity
set
  website = coalesce(detail_links.detail_url, activity.website),
  image_url = coalesce(detail_links.image_url, activity.image_url),
  image_source_url = case when detail_links.image_url is not null then coalesce(detail_links.detail_url, activity.website, activity.source_url) else activity.image_source_url end,
  updated_at = now()
from detail_links
where activity.activity_id = detail_links.activity_id;
