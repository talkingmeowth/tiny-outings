-- The prior PDF parser mixed details from neighbouring timetable rows.
-- Remove those source records before importing the council's live event pages.
delete from public.activities
where source_name = 'Waltham Forest Best Start in Life timetable';
