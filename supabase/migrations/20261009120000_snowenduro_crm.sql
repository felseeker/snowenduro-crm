-- SnowEnduro CRM: protected leads, catalog, publication jobs and Telegram delivery.
-- Public requests are accepted only through the website-lead Edge Function.

create table if not exists public.website_leads (
  id uuid primary key default gen_random_uuid(),
  public_code bigint generated always as identity unique,
  created_at timestamptz not null default now(),
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  phone text not null check (char_length(phone) between 7 and 32),
  product_interest text not null check (char_length(product_interest) between 2 and 200),
  source_page text not null check (char_length(source_page) between 1 and 600),
  compatibility_make text,
  compatibility_model text,
  compatibility_year integer check (compatibility_year is null or compatibility_year between 1950 and 2100),
  manager_comments text not null default '' check (char_length(manager_comments) <= 5000),
  status text not null default 'new' check (status in ('new', 'in_progress', 'supplier', 'sale', 'rejected')),
  idempotency_key uuid not null unique,
  consent_at timestamptz not null,
  consent_policy_version text not null check (char_length(consent_policy_version) between 1 and 80)
);
create index if not exists website_leads_created_at_idx on public.website_leads (created_at desc);
create index if not exists website_leads_status_created_at_idx on public.website_leads (status, created_at desc);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 120),
  category text not null check (category in ('snowbike', 'snowmobile')),
  name text not null check (char_length(name) between 1 and 160),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  availability text not null default 'on_order' check (availability in ('in_stock', 'on_order', 'out_of_stock')),
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_catalog_order_idx on public.products (is_published, sort_order, name);

create table if not exists public.telegram_recipients (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique check (chat_id ~ '^-?[0-9]{1,20}$'),
  label text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.website_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  sent_at timestamptz,
  unique (lead_id)
);
create index if not exists notification_outbox_state_created_idx on public.notification_outbox (state, created_at);

create table if not exists public.catalog_publication_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  expires_at timestamptz not null,
  error_message text
);
create index if not exists catalog_publication_jobs_created_idx on public.catalog_publication_jobs (created_at desc);

-- Hashes are HMAC-SHA256 values made with a server-only key; raw IP and phone values are never stored here.
create table if not exists public.website_lead_rate_limits (
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  bucket text not null check (bucket in ('ip', 'phone')),
  window_start timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (subject_hash, bucket)
);

create or replace function public.reserve_website_lead_request(p_ip_hash text, p_phone_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip_count integer;
  phone_count integer;
  current_time timestamptz := now();
begin
  if p_ip_hash !~ '^[a-f0-9]{64}$' or p_phone_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  delete from public.website_lead_rate_limits
  where window_start < current_time - interval '1 day';

  insert into public.website_lead_rate_limits as existing (subject_hash, bucket, window_start, request_count)
  values (p_ip_hash, 'ip', current_time, 1)
  on conflict (subject_hash, bucket) do update
    set window_start = case when existing.window_start < current_time - interval '15 minutes' then current_time else existing.window_start end,
        request_count = case when existing.window_start < current_time - interval '15 minutes' then 1 else existing.request_count + 1 end
  returning request_count into ip_count;

  insert into public.website_lead_rate_limits as existing (subject_hash, bucket, window_start, request_count)
  values (p_phone_hash, 'phone', current_time, 1)
  on conflict (subject_hash, bucket) do update
    set window_start = case when existing.window_start < current_time - interval '1 day' then current_time else existing.window_start end,
        request_count = case when existing.window_start < current_time - interval '1 day' then 1 else existing.request_count + 1 end
  returning request_count into phone_count;

  return ip_count <= 8 and phone_count <= 3;
end;
$$;

create or replace function public.set_snowenduro_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.enqueue_website_lead_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_outbox (lead_id, state)
  values (new.id, 'pending');
  return new;
end;
$$;

create trigger products_updated_at
before update on public.products
for each row execute function public.set_snowenduro_updated_at();

create trigger catalog_publication_jobs_updated_at
before update on public.catalog_publication_jobs
for each row execute function public.set_snowenduro_updated_at();

create trigger website_lead_notification_outbox
 after insert on public.website_leads
 for each row execute function public.enqueue_website_lead_notification();

alter table public.website_leads enable row level security;
alter table public.products enable row level security;
alter table public.telegram_recipients enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.catalog_publication_jobs enable row level security;
alter table public.website_lead_rate_limits enable row level security;

create policy website_leads_admin_access on public.website_leads
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_admin_access on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy telegram_recipients_admin_access on public.telegram_recipients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy notification_outbox_admin_read on public.notification_outbox
  for select to authenticated using (public.is_admin());
create policy catalog_publication_jobs_admin_read on public.catalog_publication_jobs
  for select to authenticated using (public.is_admin());

revoke all on table public.website_leads, public.products, public.telegram_recipients, public.notification_outbox, public.catalog_publication_jobs, public.website_lead_rate_limits from anon;
revoke all on table public.website_lead_rate_limits from authenticated;
grant select, insert, update, delete on table public.website_leads, public.products, public.telegram_recipients to authenticated;
grant select on table public.notification_outbox, public.catalog_publication_jobs to authenticated;
grant all on table public.website_leads, public.products, public.telegram_recipients, public.notification_outbox, public.catalog_publication_jobs, public.website_lead_rate_limits to service_role;
revoke all on function public.reserve_website_lead_request(text, text) from public, anon, authenticated;
grant execute on function public.reserve_website_lead_request(text, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-images', 'catalog-images', false, 12582912, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy catalog_images_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'catalog-images' and public.is_admin());
create policy catalog_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog-images' and public.is_admin());
create policy catalog_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'catalog-images' and public.is_admin()) with check (bucket_id = 'catalog-images' and public.is_admin());
create policy catalog_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'catalog-images' and public.is_admin());
