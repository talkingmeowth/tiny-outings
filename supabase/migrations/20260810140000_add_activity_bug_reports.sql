create table if not exists public.activity_bug_reports (
  report_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  reported_by_user_id uuid references auth.users(id) on delete set null,
  report_text text not null check (char_length(trim(report_text)) between 3 and 2000),
  source_url text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists activity_bug_reports_activity_idx
  on public.activity_bug_reports(activity_id, created_at desc);

alter table public.activity_bug_reports enable row level security;

create policy "Anyone can report an activity issue"
on public.activity_bug_reports
for insert
with check (true);

create policy "Admins can read activity reports"
on public.activity_bug_reports
for select
using (public.is_tiny_outings_admin());
