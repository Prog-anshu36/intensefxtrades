-- Unlimited-time shared VIP keys.
--
-- Adds a per-code `no_expiry` flag. A redemption of a no_expiry code stores
-- subscriptions.current_period_end = NULL, which every part of the system
-- already treats as "active, no end date" (normalizePlan, the billing
-- function and the plan countdown). Such a key is valid for every account and
-- can be redeemed any number of times on the same account (the per-account
-- limit column now accepts NULL, meaning no limit). Codes without the flag behave exactly
-- as before (custom duration_hours, or the 30-day default).
--
-- As with earlier shared codes only the one-way SHA-256 hash is stored; the
-- plaintext keys appear nowhere in the database, this file or frontend code.
-- Mobile keyboards often capitalise the first letter, so each key is stored in
-- three spellings (lowercase, Capitalised, UPPERCASE). Product per key:
--   e24dd221… (+2 case variants) -> golden_vip
--   5a6760b9… (+2 case variants) -> golden_vip
--   1a80b069… (+2 case variants) -> red
--   07ed4007… (+2 case variants) -> purple
alter table public.vip_access_codes
  add column if not exists no_expiry boolean not null default false;
-- NULL = unlimited redemptions per account. Existing rows keep their numeric limit.
alter table public.vip_access_codes alter column max_redemptions_per_account drop not null;

create or replace function public.redeem_vip_key(redemption_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); hash text; product text; plan text; ends timestamptz;
  attempts_count integer; sub public.subscriptions%rowtype;
  private_key public.vip_redemptions%rowtype; shared boolean:=false;
  duration_h integer; max_redemptions integer; redemption_count integer; no_exp boolean;
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
  select product_code,duration_hours,max_redemptions_per_account,no_expiry into product,duration_h,max_redemptions,no_exp from public.vip_access_codes where key_hash=hash and active;
  if found then
    shared:=true;
    select count(*) into redemption_count from public.vip_access_claims where user_id=uid and key_hash=hash;
    if max_redemptions is not null and redemption_count>=max_redemptions then return jsonb_build_object('ok',false,'reason','exhausted'); end if;
    -- no_expiry: NULL end date (never expires). Otherwise custom hours, default 30 days.
    ends:=case when coalesce(no_exp,false) then null else now()+make_interval(hours=>coalesce(duration_h,720)) end;
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
    provider_subscription_id=null,
    billing_interval=case when not shared then null when coalesce(no_exp,false) then 'unlimited' else (coalesce(duration_h,720)||' hours') end,
    cancel_at_period_end=false,cancelled_at=null,grace_period_end=null,updated_at=now() where user_id=uid;
  insert into public.subscription_history(user_id,plan_code,status,event_type,provider,details) values(uid,plan,'active','vip_redeemed','vip',jsonb_build_object('product',product,'ends_at',ends,'no_expiry',coalesce(no_exp,false)));
  return jsonb_build_object('ok',true,'ends_at',ends);
end;
$$;
revoke all on function public.redeem_vip_key(text) from public,anon;
grant execute on function public.redeem_vip_key(text) to authenticated;

insert into public.vip_access_codes (key_hash, product_code, duration_hours, max_redemptions_per_account, price_inr, active, no_expiry) values
  ('e24dd2210803b4737a9bd9e3163a4ca807b63201c3bc32b68fb122ca52efff36', 'golden_vip', null, null, 0, true, true),
  ('c519e76f6719da3d089433d16ec68662b80087361af1253b0f1ca12fa4da9781', 'golden_vip', null, null, 0, true, true),
  ('1f9ed0b6dba0bc0897ac10ecc763c5ac848e1c03d4db629ba60b4ca6e575d256', 'golden_vip', null, null, 0, true, true),
  ('5a6760b9655e8eeecffb6262fffce2a8fec81ef0d30a65bffa148b789727885b', 'golden_vip', null, null, 0, true, true),
  ('4c775527f70a1b2c19c9f8fb24313d3be90eefdb2aa38410b71cabe43174c151', 'golden_vip', null, null, 0, true, true),
  ('bfa7349606eab2eedd784b79fd26413e675473f1b37a555cedaed476599f13cf', 'golden_vip', null, null, 0, true, true),
  ('1a80b0691b696fe18dbc9e94722bc7bb2325d76078bda9fdd0c1760bd4cd9864', 'red', null, null, 0, true, true),
  ('1d6953e03ac29b9aba73dfcd57d8a5cb47991342495891f19b1cb713da89eb5d', 'red', null, null, 0, true, true),
  ('867ea78c4a3a9e0e07cc9c41d0744fb741f7a3fb7ff14164fa20224233d701f8', 'red', null, null, 0, true, true),
  ('07ed400759a0f606a8b5bfa84712aabe7d1b1c45cb6536c8a5727446b6647b84', 'purple', null, null, 0, true, true),
  ('957b0b874524d09a5d035007f821a094a22b678fb157991e28bba1fe21d4e6b9', 'purple', null, null, 0, true, true),
  ('7821a03e83d54c4519defe9980f3c2f15a57a4cb39d1416b4bae327a98c6447a', 'purple', null, null, 0, true, true)
on conflict (key_hash) do update set
  product_code=excluded.product_code, duration_hours=null, max_redemptions_per_account=null,
  price_inr=0, active=true, no_expiry=true;
