-- Developer promo codes.
--
-- A developer account (allow-listed by email below) can create its own promo
-- codes from the app. Codes are stored in public.vip_access_codes, so they are
-- redeemed through the existing public.redeem_vip_key function and therefore
-- work on every account (case-insensitive, per-account limits, rate limiting
-- and the never-downgrade rule all apply unchanged).
--
-- Security: the developer check runs on the server. is_developer() requires the
-- signed-in account's CONFIRMED email to be in public.developer_accounts, and
-- the three dev_* functions refuse everyone else. The list of developer emails
-- is not readable or writable from the browser; add another developer with SQL:
--   insert into public.developer_accounts(email) values ('someone@example.com');
--
-- Depends on 20261103000000_unlimited_vip_keys.sql (no_expiry, nullable limit).

create table if not exists public.developer_accounts (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.developer_accounts enable row level security;
revoke all on public.developer_accounts from public, anon, authenticated;
grant all on public.developer_accounts to service_role;

insert into public.developer_accounts (email) values ('singhanshu96502@gmail.com')
  on conflict (email) do nothing;

-- Developer-created codes keep a readable label (the code itself) and a note so
-- they can be listed later. Built-in codes keep label = NULL (hash only).
alter table public.vip_access_codes
  add column if not exists code_label text,
  add column if not exists note text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create or replace function public.is_developer()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from auth.users u
    join public.developer_accounts d on lower(u.email) = d.email
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_developer() from public, anon;
grant execute on function public.is_developer() to authenticated;

-- p_max_per_account NULL = unlimited redemptions per account.
-- p_unlimited_time true = the granted access never expires (duration ignored).
create or replace function public.dev_create_promo_code(
  p_code text, p_product text, p_duration_hours integer, p_unlimited_time boolean,
  p_max_per_account integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare norm text; h text; unlimited boolean:=coalesce(p_unlimited_time,false);
begin
  if not public.is_developer() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  norm:=upper(trim(coalesce(p_code,'')));
  if norm !~ '^[A-Z0-9_-]{3,32}$' then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
  if p_product is null or p_product not in ('green','purple','red','golden_vip') then return jsonb_build_object('ok',false,'reason','invalid_product'); end if;
  if not unlimited and (p_duration_hours is null or p_duration_hours<1 or p_duration_hours>87600) then return jsonb_build_object('ok',false,'reason','invalid_duration'); end if;
  if p_max_per_account is not null and (p_max_per_account<1 or p_max_per_account>10000) then return jsonb_build_object('ok',false,'reason','invalid_limit'); end if;
  h:=encode(sha256(convert_to(norm,'UTF8')),'hex');
  if exists (select 1 from public.vip_access_codes where key_hash=h) then return jsonb_build_object('ok',false,'reason','exists'); end if;
  insert into public.vip_access_codes
    (key_hash, product_code, duration_hours, max_redemptions_per_account, price_inr, active, no_expiry, code_label, note, created_by)
  values
    (h, p_product, case when unlimited then null else p_duration_hours end, p_max_per_account, 0, true, unlimited,
     norm, nullif(left(trim(coalesce(p_note,'')),120),''), auth.uid());
  return jsonb_build_object('ok',true,'code',norm);
end;
$$;

create or replace function public.dev_list_promo_codes()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_developer() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  return jsonb_build_object('ok',true,'codes',coalesce((
    select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
      select v.key_hash, v.code_label as code, v.product_code, v.duration_hours, v.no_expiry,
             v.max_redemptions_per_account as max_per_account, v.active, v.note, v.created_at,
             (select count(*) from public.vip_access_claims c where c.key_hash=v.key_hash) as redemptions,
             (select count(distinct c.user_id) from public.vip_access_claims c where c.key_hash=v.key_hash) as accounts
      from public.vip_access_codes v where v.code_label is not null
    ) r), '[]'::jsonb));
end;
$$;

create or replace function public.dev_set_promo_active(p_key_hash text, p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not public.is_developer() then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  update public.vip_access_codes set active=coalesce(p_active,false)
    where key_hash=p_key_hash and code_label is not null;
  get diagnostics n = row_count;
  if n=0 then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.dev_create_promo_code(text,text,integer,boolean,integer,text) from public, anon;
revoke all on function public.dev_list_promo_codes() from public, anon;
revoke all on function public.dev_set_promo_active(text,boolean) from public, anon;
grant execute on function public.dev_create_promo_code(text,text,integer,boolean,integer,text) to authenticated;
grant execute on function public.dev_list_promo_codes() to authenticated;
grant execute on function public.dev_set_promo_active(text,boolean) to authenticated;
