-- Both named Tiny Outings maintainers can review submissions and curate listings.
create or replace function public.is_tiny_outings_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'talkingmeowth06@gmail.com',
    'benfielden@gmail.com'
  );
$$;
