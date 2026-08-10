-- Keep the two known Tiny Outings administrator email spellings aligned with
-- the client-side admin check.
create or replace function public.is_tiny_outings_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'talkingmeowth06@gmail.com',
    'talkingmeowtho6@gmail.com',
    'benfielden@gmail.com'
  );
$$;
