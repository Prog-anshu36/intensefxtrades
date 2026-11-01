-- Shared VIP codes gain per-account redemption limits and a custom grant
-- duration (instead of always one month), so a short-lived promo code can
-- grant e.g. a few hours of access, redeemable a fixed number of times per
-- account before it stops working for that account. Existing shared codes
-- keep their original one-month, once-per-account behaviour (defaults below
-- preserve that for any row that doesn't set its own duration/limit).
alter table public.vip_access_codes
  add column if not exists duration_hours integer check(duration_hours is null or duration_hours > 0),
  add column if not exists max_redemptions_per_account integer not null default 1 check(max_redemptions_per_account > 0),
  add column if not exists price_inr integer not null default 0 check(price_inr >= 0);

-- Redemption counting per account now needs more than one claim row per
-- (user_id, key_hash), so the claims table moves from a two-column primary
-- key to a surrogate id. The (user_id, key_hash) pair is no longer unique by
-- itself; the redeem function enforces the per-account limit instead.
alter table public.vip_access_claims drop constraint if exists vip_access_claims_pkey;
alter table public.vip_access_claims add column if not exists id bigint generated always as identity;
alter table public.vip_access_claims add primary key (id);
create index if not exists vip_access_claims_user_key_idx on public.vip_access_claims(user_id, key_hash);

create or replace function public.redeem_vip_key(redemption_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); hash text; product text; plan text; ends timestamptz;
  attempts_count integer; sub public.subscriptions%rowtype;
  private_key public.vip_redemptions%rowtype; shared boolean:=false;
  duration_h integer; max_redemptions integer; redemption_count integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if length(trim(redemption_key))<3 or length(redemption_key)>256 then return jsonb_build_object('ok',false,'reason','invalid'); end if;
  insert into public.vip_access_attempts values(uid,now(),1)
    on conflict(user_id) do update set
      attempts=case when public.vip_access_attempts.window_started>now()-interval '10 minutes' then public.vip_access_attempts.attempts+1 else 1 end,
      window_started=case when public.vip_access_attempts.window_started>now()-interval '10 minutes' then public.vip_access_attempts.window_started else now() end
    returning attempts into attempts_count;
  if attempts_count>5 then return jsonb_build_object('ok',false,'reason','rate_limited'); end if;
  select * into sub from public.subscriptions where user_id=uid for update;
  if not found then raise exception 'Subscription record is missing'; end if;
  hash:=encode(sha256(convert_to(trim(redemption_key),'UTF8')),'hex');
  select product_code,duration_hours,max_redemptions_per_account into product,duration_h,max_redemptions from public.vip_access_codes where key_hash=hash and active;
  if found then
    shared:=true;
    select count(*) into redemption_count from public.vip_access_claims where user_id=uid and key_hash=hash;
    if redemption_count>=coalesce(max_redemptions,1) then return jsonb_build_object('ok',false,'reason','exhausted'); end if;
    ends:=now()+make_interval(hours=>coalesce(duration_h,720)); -- default: 30 days, matching the original shared-code grant
    plan:=case when product='golden_vip' then 'red' else product end;
  else
    select * into private_key from public.vip_redemptions where key_hash=hash for update;
    if not found then return jsonb_build_object('ok',false,'reason','invalid'); end if;
    if private_key.redeemed_at is not null then return jsonb_build_object('ok',false,'reason','used'); end if;
    if private_key.expires_at<=now() or private_key.subscription_ends_at<=now() then return jsonb_build_object('ok',false,'reason','expired'); end if;
    plan:=private_key.plan_code; product:=plan; ends:=private_key.subscription_ends_at;
  end if;
  if sub.status in ('active','trialing') and (sub.current_period_end is null or sub.current_period_end>now()) and
    array_position(array['blue','green','purple','red','golden_vip'],case when sub.product_code='golden_vip' then sub.product_code else sub.plan_code end)>
    array_position(array['blue','green','purple','red','golden_vip'],product) then return jsonb_build_object('ok',false,'reason','downgrade'); end if;
  if shared then insert into public.vip_access_claims(user_id,key_hash) values(uid,hash);
  else update public.vip_redemptions set redeemed_by=uid,redeemed_at=now() where key_hash=hash; end if;
  update public.subscriptions set plan_code=plan,product_code=product,status='active',provider='vip',current_period_end=ends,
    provider_subscription_id=null,billing_interval=case when shared then (coalesce(duration_h,720)||' hours') else null end,cancel_at_period_end=false,cancelled_at=null,grace_period_end=null,updated_at=now() where user_id=uid;
  insert into public.subscription_history(user_id,plan_code,status,event_type,provider,details) values(uid,plan,'active','vip_redeemed','vip',jsonb_build_object('product',product,'ends_at',ends));
  return jsonb_build_object('ok',true,'ends_at',ends);
end;
$$;
revoke all on function public.redeem_vip_key(text) from public,anon;
grant execute on function public.redeem_vip_key(text) to authenticated;

-- Two promotional codes. Only the one-way hash is ever stored — the plaintext
-- key is never written to the database, a migration file other than this one,
-- or any frontend code; it exists in cleartext only in the message handed to
-- whoever is meant to redeem it.
--   NEWFX   -> Red · Elite,   6 hours,  free,  redeemable twice per account
--   FIRST9  -> Purple · Pro, 24 hours, ₹9,    redeemable once per account
insert into public.vip_access_codes (key_hash, product_code, duration_hours, max_redemptions_per_account, price_inr, active) values
  ('d7cb7932594d754ff9acc29954bdd4f7ccbc9200edd365db1a1f372b1642df1e', 'red', 6, 2, 0, true),
  ('a97be70dfd0ec05f5129e42560d7f4bf1687cd75efd706fc9edeb00f14df5369', 'purple', 24, 1, 9, true)
on conflict (key_hash) do update set
  product_code=excluded.product_code, duration_hours=excluded.duration_hours,
  max_redemptions_per_account=excluded.max_redemptions_per_account, price_inr=excluded.price_inr, active=true;
