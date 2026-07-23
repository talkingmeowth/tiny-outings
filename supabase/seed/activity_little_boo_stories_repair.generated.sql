-- Repair the legacy Little Boo record that retained a category-page link and
-- an obsolete organiser domain after the schedule importer refreshed.
update public.activities
set
  website = 'https://www.happity.co.uk/schedules/little-boo-stories-london-christ-church-highbury-mini-boo-sensory-theatre',
  organiser_website = 'https://www.littleboostories.com/',
  image_url = 'https://www.littleboostories.com/quality_auto/79FCAAF1-6EC0-4A07-BBE4-41E8CD4E8782_edited_edited.png',
  image_source_url = 'https://www.littleboostories.com/',
  updated_at = now()
where activity_id = '61a3f298-2bbc-4215-9fcd-91f4eb84c4cf'::uuid;
