-- Track delivery per Telegram recipient so a retry does not resend messages already delivered.
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  recipient_id uuid not null references public.telegram_recipients(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (outbox_id, recipient_id)
);
create index if not exists notification_deliveries_state_idx on public.notification_deliveries (outbox_id, state);
alter table public.notification_deliveries enable row level security;
create policy notification_deliveries_admin_read on public.notification_deliveries for select to authenticated using (public.is_admin());
revoke all on table public.notification_deliveries from anon;
grant select on table public.notification_deliveries to authenticated;
grant all on table public.notification_deliveries to service_role;
create trigger notification_deliveries_updated_at before update on public.notification_deliveries for each row execute function public.set_snowenduro_updated_at();
