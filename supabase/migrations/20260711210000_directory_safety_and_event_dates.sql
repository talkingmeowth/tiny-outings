-- Keep the public directory focused on babies and young children.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where source_name = 'Eventbrite London baby listings'
  and not (
    coalesce(activity_name, '') || ' ' || coalesce(description, '')
  ) ~* '(baby|babies|toddler|child|children|family|parent|mum|mom|mother|dad|nct|pregnan|postnatal)';

-- These Fever entries are adult-only, a gift card, or aimed at older children.
update public.activities
set public_listing_status = 'archived', updated_at = now()
where source_name = 'Fever London family listings'
  and (
    activity_name in (
      'Beauty & Wellness - Gift Card',
      'Harry Potter & the Cursed Child Parts One & Two',
      'Silent Disco & Retro Gaming Party',
      'Space Explorers: The ISS Experience - London',
      'Stranger Things: The First Shadow',
      'The Jury Experience - The 20 Million Dollar Heist'
    )
    or coalesce(description, '') ~* '(age requirement:\s*21\+|suitable for 10\+|age requirement:\s*8\+)'
  );

-- Fever uses a ticket selector for many experiences. Do not treat an undated
-- selector as a swipeable event; retain it in the source record for later refresh.
update public.activities
set
  activity_date = null,
  available_dates = '{}',
  availability_start_date = null,
  availability_end_date = null,
  availability_type = 'unknown',
  availability_notes = 'A date has not been confirmed from Fever. Check Fever before planning.',
  updated_at = now()
where source_name = 'Fever London family listings'
  and public_listing_status = 'published';

update public.activities
set
  availability_start_date = date '2026-10-16',
  availability_end_date = date '2026-11-01',
  availability_type = 'date_range',
  availability_notes = 'Available 16 October to 1 November 2026. Select a time on Fever before booking.',
  updated_at = now()
where source_name = 'Fever London family listings'
  and activity_name = 'Halloween at Kew';

update public.activities
set
  activity_date = date '2026-08-23',
  available_dates = array[date '2026-08-23'],
  availability_type = 'one_off',
  availability_notes = 'Sunday 23 August 2026. Select a session on Fever before booking.',
  updated_at = now()
where source_name = 'Fever London family listings'
  and activity_name = 'Raver Tots Wembley';
