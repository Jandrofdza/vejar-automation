create extension if not exists "pgcrypto";

insert into storage.buckets (id, name, public)
values ('podio_uploads', 'podio_uploads', false)
on conflict (id) do nothing;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  podio_item_id bigint not null,
  intake_app_id bigint,
  source text not null default 'podio',
  status text not null default 'queued',
  error text,
  payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  podio_file_id bigint not null,
  file_name text not null,
  mime text,
  storage_path text not null,
  size_bytes bigint,
  created_at timestamptz default now(),
  unique (job_id, podio_file_id)
);

create table if not exists public.results (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  model_version text,
  raw_json jsonb,
  created_at timestamptz default now()
);

create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists update_jobs_updated_at on public.jobs;
create trigger update_jobs_updated_at
before update on public.jobs
for each row execute procedure update_updated_at_column();
