-- Match legacy Fever titles by their stable source URLs, not typographic punctuation.
UPDATE public.activities
SET public_listing_status = 'archived', updated_at = now()
WHERE source_url = 'https://feverup.com/m/122445';

UPDATE public.activities
SET description = 'Indoor Camden theme park with rides, arcade games and soft-play zones for little explorers.',
    updated_at = now()
WHERE source_url = 'https://feverup.com/m/309703';

UPDATE public.activities
SET description = 'Self-guided superhero adventure around Kensington Gardens for children aged 4 to 8.',
    updated_at = now()
WHERE source_url = 'https://feverup.com/m/470942';
