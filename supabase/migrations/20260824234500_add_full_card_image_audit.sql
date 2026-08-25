alter table public.activities
  add column if not exists audit_image_url text,
  add column if not exists audit_image_source_url text,
  add column if not exists audit_image_reviewed_at timestamptz,
  add column if not exists audit_image_model text,
  add column if not exists audit_image_workflow_version text,
  add column if not exists audit_image_status text,
  add column if not exists audit_image_accuracy boolean,
  add column if not exists audit_image_essence boolean,
  add column if not exists audit_image_quality boolean,
  add column if not exists audit_image_original_url text,
  add column if not exists audit_image_original_source_field text,
  add column if not exists audit_image_reason text;

alter table public.activities
  drop constraint if exists activities_audit_image_status_check,
  add constraint activities_audit_image_status_check check (
    audit_image_status is null or audit_image_status in (
      'pass',
      'needs_replacement',
      'replaced',
      'no_replacement'
    )
  );

comment on column public.activities.audit_image_url is
  'Audited replacement selected after reviewing the previously displayed non-admin card image.';
comment on column public.activities.audit_image_original_url is
  'Exact displayed image URL assessed by the latest full card-image audit.';

create table if not exists public.activity_card_image_audits (
  audit_id bigint generated always as identity primary key,
  activity_id uuid not null references public.activities(activity_id) on delete cascade,
  original_image_url text not null,
  original_source_field text not null,
  reviewed_at timestamptz not null default now(),
  provider text not null,
  model text not null,
  workflow_version text not null,
  accurate boolean not null,
  captures_essence boolean not null,
  good_quality boolean not null,
  original_width integer,
  original_height integer,
  decision text not null check (decision in ('pass', 'needs_replacement')),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (activity_id, original_image_url, provider, model, workflow_version)
);

alter table public.activity_card_image_audits enable row level security;
revoke all on public.activity_card_image_audits from anon, authenticated;
grant select, insert, update on public.activity_card_image_audits to service_role;
grant usage, select on sequence public.activity_card_image_audits_audit_id_seq to service_role;

create index if not exists activity_card_image_audits_activity_idx
  on public.activity_card_image_audits (activity_id, reviewed_at desc);

-- Extend the Wikimedia guard to audited replacements and their retained source.
alter table public.activities
  drop constraint if exists activities_wikimedia_category_policy_check,
  add constraint activities_wikimedia_category_policy_check check (
    trim(regexp_replace(replace(lower(coalesce(category, '')), '&', 'and'), '[^a-z0-9]+', ' ', 'g'))
      in ('parks and outdoor play', 'museums and culture', 'family activities')
    or (
      nullif(trim(wikimedia_image_url), '') is null
      and concat_ws(' ',
        admin_cover_image_url,
        audit_image_url,
        audit_image_source_url,
        user_image_url,
        scraped_image_url,
        organiser_website_downloaded_image,
        website_downloaded_image,
        website_image_url,
        listing_image_url,
        image_url,
        image_source_url
      ) !~* '(wikimedia(?:\.org| commons)|wikipedia(?:\.org)?)'
    )
  );
