-- extensions
create extension if not exists "pgcrypto";

-- storage bucket
insert into storage.buckets (id, name, public)
values ('podio_uploads','podio_uploads', false)
on conflict (id) do nothing;

-- jobs
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  podio_item_id bigint not null,
  intake_app_id bigint,
  source text,
  status text not null default 'queued',
  payload jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- files
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  podio_file_id bigint not null,
  file_name text not null,
  mime text,
  storage_path text not null,
  size_bytes bigint,
  created_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='files_job_file_key') then
    alter table public.files add constraint files_job_file_key unique (job_id, podio_file_id);
  end if;
end $$;

-- results
create table if not exists public.results (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  model_version text,
  raw_json jsonb,
  created_at timestamptz default now()
);

-- updated_at trigger
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;
drop trigger if exists update_jobs_updated_at on public.jobs;
create trigger update_jobs_updated_at
before update on public.jobs
for each row execute procedure update_updated_at_column();

-- ensure intake_app_id is nullable
alter table public.jobs alter column intake_app_id drop not null;
