-- Subscription lifecycle fields and an append-only history for trusted billing
-- webhook processing. Browser clients remain read-only for subscription state.

alter table public.subscriptions
  add column if not exists provider text,
  add column if not exists provider_subscription_id text,
  add column if not exists billing_interval text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists grace_period_end timestamptz;

create unique index if not exists subscriptions_provider_subscription_id_unique
  on public.subscriptions(provider, provider_subscription_id)
  where provider_subscription_id is not null;

create table if not exists public.subscription_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null check (plan_code in ('blue','green','purple','red')),
  status text not null check (status in ('active','trialing','past_due','cancelled','expired')),
  event_type text not null,
  provider text,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

alter table public.subscription_history enable row level security;
revoke all on public.subscription_history from anon, authenticated;
revoke all on public.subscription_history from public;
grant select on public.subscription_history to authenticated;
drop policy if exists "Users can read their subscription history" on public.subscription_history;
create policy "Users can read their subscription history" on public.subscription_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- Keep payment callback IDs for replay-safe webhook handling. No raw payment
-- payload or secret is exposed to browser roles.
create table if not exists public.processed_billing_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.processed_billing_events enable row level security;
revoke all on public.processed_billing_events from anon, authenticated;
revoke all on public.processed_billing_events from public;
