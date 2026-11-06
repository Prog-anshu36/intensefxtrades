-- Registered users keep a complete, device-independent browser workspace.
-- The JSON snapshots preserve the existing trading engine's data model exactly;
-- normalized rows support safe, idempotent history reads and future reporting.

create table if not exists public.cloud_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  state jsonb not null,
  preferences jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null check (char_length(account_id) between 1 and 160),
  name text not null default 'Account',
  account_type text not null default 'Demo',
  currency text not null default 'USD',
  currency_symbol text not null default '$',
  archived boolean not null default false,
  initial_balance numeric not null default 0,
  balance numeric not null default 0,
  state jsonb not null,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id)
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null check (char_length(account_id) between 1 and 160),
  trade_id text not null check (char_length(trade_id) between 1 and 220),
  status text not null default 'closed',
  symbol text,
  side text,
  opened_at timestamptz,
  closed_at timestamptz,
  pnl numeric,
  state jsonb not null,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, trade_id)
);

create table if not exists public.account_equity_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null check (char_length(account_id) between 1 and 160),
  point_id text not null check (char_length(point_id) between 1 and 220),
  recorded_at timestamptz,
  balance numeric not null default 0,
  equity numeric not null default 0,
  state jsonb not null,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, point_id)
);

create table if not exists public.prop_firm_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id text not null check (char_length(evaluation_id) between 1 and 180),
  owner_account_id text,
  status text,
  phase integer,
  state jsonb not null,
  client_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, evaluation_id)
);

create table if not exists public.performance_analytics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null check (char_length(account_id) between 1 and 160),
  snapshot_key text not null check (char_length(snapshot_key) between 1 and 180),
  computed_at timestamptz not null default now(),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id, snapshot_key)
);

create or replace function public.set_cloud_history_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['cloud_workspaces','trading_accounts','trades','account_equity_history','prop_firm_evaluations','performance_analytics']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_cloud_history_updated_at()', table_name, table_name);
  end loop;
end;
$$;

create index if not exists trading_accounts_user_updated_idx on public.trading_accounts (user_id, updated_at desc);
create index if not exists trades_user_account_closed_idx on public.trades (user_id, account_id, closed_at desc);
create index if not exists account_equity_history_user_account_recorded_idx on public.account_equity_history (user_id, account_id, recorded_at desc);
create index if not exists prop_firm_evaluations_user_updated_idx on public.prop_firm_evaluations (user_id, updated_at desc);
create index if not exists performance_analytics_user_account_idx on public.performance_analytics (user_id, account_id, computed_at desc);

revoke all on function public.set_cloud_history_updated_at() from public;
