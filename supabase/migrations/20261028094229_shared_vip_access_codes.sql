create table public.vip_access_codes (
  key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
  product_code text not null check(product_code in ('green','purple','red','golden_vip')),
  active boolean not null default true
);
create table public.vip_access_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null references public.vip_access_codes(key_hash),
  redeemed_at timestamptz not null default now(),
  primary key(user_id,key_hash)
);
create table public.vip_access_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null,
  attempts integer not null
);
alter table public.vip_access_codes enable row level security;
alter table public.vip_access_claims enable row level security;
alter table public.vip_access_attempts enable row level security;
revoke all on public.vip_access_codes,public.vip_access_claims,public.vip_access_attempts from public,anon,authenticated;
grant all on public.vip_access_codes,public.vip_access_claims,public.vip_access_attempts to service_role;

create or replace function public.redeem_vip_key(redemption_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); hash text; product text; plan text; ends timestamptz;
  attempts_count integer; sub public.subscriptions%rowtype;
  private_key public.vip_redemptions%rowtype; shared boolean:=false;
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
  select product_code into product from public.vip_access_codes where key_hash=hash and active;
  if found then
    shared:=true;
    if exists(select 1 from public.vip_access_claims where user_id=uid and key_hash=hash) then return jsonb_build_object('ok',false,'reason','used'); end if;
    ends:=now()+interval '1 month';
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
    provider_subscription_id=null,billing_interval=case when shared then '1 month' else null end,cancel_at_period_end=false,cancelled_at=null,grace_period_end=null,updated_at=now() where user_id=uid;
  insert into public.subscription_history(user_id,plan_code,status,event_type,provider,details) values(uid,plan,'active','vip_redeemed','vip',jsonb_build_object('product',product,'ends_at',ends));
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.redeem_vip_key(text) from public,anon;
grant execute on function public.redeem_vip_key(text) to authenticated;
