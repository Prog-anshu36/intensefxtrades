alter table public.subscriptions add column if not exists product_code text;
create table public.billing_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null check (product_code in ('green','purple','red','golden_vip')),
  months integer not null check (months in (1,3,12)),
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency='INR'),
  razorpay_order_id text not null unique,
  payment_id text unique,
  status text not null default 'created' check (status in ('created','fulfilled')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index billing_orders_user_created on public.billing_orders(user_id,created_at desc);
alter table public.billing_orders enable row level security;
revoke all on public.billing_orders from public,anon,authenticated;
grant select on public.billing_orders to authenticated;
grant all on public.billing_orders to service_role;
create policy "Users can read own purchases" on public.billing_orders for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.fulfill_prepaid_order(order_ref uuid,payment_ref text)
returns void language plpgsql security definer set search_path='' as $$
declare
  purchase public.billing_orders%rowtype;
  sub public.subscriptions%rowtype;
  starts timestamptz;
  ends timestamptz;
  target_plan text;
begin
  select * into purchase from public.billing_orders where id=order_ref for update;
  if not found then raise exception 'Unknown purchase'; end if;
  if purchase.status='fulfilled' then
    if purchase.payment_id<>payment_ref then raise exception 'Payment mismatch'; end if;
    return;
  end if;
  if payment_ref !~ '^pay_[a-zA-Z0-9]+$' then raise exception 'Invalid payment'; end if;
  select * into sub from public.subscriptions where user_id=purchase.user_id for update;
  if not found then raise exception 'Missing subscription'; end if;
  target_plan:=case when purchase.product_code='golden_vip' then 'red' else purchase.product_code end;
  starts:=now();
  -- Same-product renewals preserve the unexpired prepaid period.
  if sub.provider='razorpay' and sub.product_code=purchase.product_code and sub.status='active' and sub.current_period_end>starts then starts:=sub.current_period_end; end if;
  ends:=starts+make_interval(months=>purchase.months);
  update public.billing_orders set status='fulfilled',payment_id=payment_ref,fulfilled_at=now() where id=purchase.id;
  update public.subscriptions set plan_code=target_plan,product_code=purchase.product_code,status='active',provider='razorpay',provider_subscription_id=purchase.razorpay_order_id,billing_interval=purchase.months||' months',current_period_end=ends,cancel_at_period_end=false,cancelled_at=null,grace_period_end=null,updated_at=now() where user_id=purchase.user_id;
  insert into public.subscription_history(user_id,plan_code,status,event_type,provider,details) values(purchase.user_id,target_plan,'active','prepaid_payment_captured','razorpay',jsonb_build_object('purchase',purchase.id,'product',purchase.product_code,'months',purchase.months,'amount_paise',purchase.amount_paise,'ends_at',ends));
end;
$$;
revoke all on function public.fulfill_prepaid_order(uuid,text) from public,anon,authenticated;
grant execute on function public.fulfill_prepaid_order(uuid,text) to service_role;

