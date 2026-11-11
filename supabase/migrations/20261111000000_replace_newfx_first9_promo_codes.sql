-- NEWFX and FIRST9 are retired (users reported they "don't work at all" —
-- most likely because earlier migrations were never run on this database).
-- Replaced with NEWFOREX and FIRST90: same effect as the originals, but
-- stored as proper promo codes (code_label set) so they show up and can be
-- disabled/re-enabled from the developer promo-code panel like any code a
-- developer creates there — not a hidden, unmanageable "VIP key".
--
-- Depends on 20261103000000_unlimited_vip_keys.sql and
-- 20261105000000_developer_promo_codes.sql (code_label, note, created_at).

delete from public.vip_access_codes where key_hash in (
  'd7cb7932594d754ff9acc29954bdd4f7ccbc9200edd365db1a1f372b1642df1e', -- NEWFX
  'a97be70dfd0ec05f5129e42560d7f4bf1687cd75efd706fc9edeb00f14df5369'  -- FIRST9
);

insert into public.vip_access_codes
  (key_hash, product_code, duration_hours, max_redemptions_per_account, price_inr, active, no_expiry, code_label, note) values
  ('668948d7920118bc5d38e53546b8377c6e0f9bcdafc1cab906d7a28db38b0e2a', 'red',    6, 2, 0, true, false, 'NEWFOREX', 'Public promo code'),
  ('a8ec6839948cb51026fb63f182a3e7c7ac42d841cef9ca760fe5610001c4c619', 'purple', 24, 1, 9, true, false, 'FIRST90', 'Public promo code')
on conflict (key_hash) do update set
  product_code = excluded.product_code, duration_hours = excluded.duration_hours,
  max_redemptions_per_account = excluded.max_redemptions_per_account,
  price_inr = excluded.price_inr, active = true, no_expiry = false,
  code_label = excluded.code_label, note = excluded.note;
