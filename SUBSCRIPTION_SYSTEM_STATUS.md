# Subscription system (initial, pre-auth integration)

## Implemented in this phase

- Four centrally defined plans and one feature entitlement matrix in `frontend/static/js/subscription.js`.
- Current subscription is read from `IntenseFXAuth.getSubscription()` when available; missing, invalid, expired, or non-active subscriptions resolve to Blue. Plan colors are display-only.
- Plan comparison and feature-upgrade explanations are available under **Plans & Billing** and Settings → Subscription.
- Navigation gates apply to Analysis/Performance, Trading Analysis, AI Coach, and the chart workspace according to their individual entitlements.
- Replay actions are blocked unless the plan includes replay. Purple replay dates are limited to the most recent 365 days of the actual instrument dataset; Red uses the full reported range.
- Technical indicators are gated separately from chart volume.
- Blue account creation is limited to one account, counting archived accounts, in both the UI and the Flask trading API.
- Supabase schema migration adds subscription lifecycle fields and read-only user history scaffolding. Client roles cannot change subscription entitlements.

## Configuration

Optional public plan prices can be supplied before `subscription.js` loads:

```js
window.IntenseFXPlanPricing = { green: null, purple: null, red: null };
```

`null` leaves the card at “Price to be configured”. Values are public display values only; they never grant a plan. Keep this unset until the actual prices and billing interval are approved.

Apply migrations in order with the Supabase CLI or SQL editor. The current Supabase auth URL/key remain blank in `frontend/static/js/auth-config.js`, so no cloud user or paid plan can currently be activated. Existing auth setup steps are in `SUPABASE_AUTH_SETUP.md`.

## Not connected yet

- There is no checkout provider, payment webhook, subscription admin operation, or paid-plan activation path. Upgrade cards are deliberately disabled and do not simulate purchases.
- GitHub Pages publishes the browser app, and the historical CSV-derived chunks in `history/` are public static files. Frontend gates cannot make those files private. The current local Flask/Pyodide API has no trusted Supabase bearer-token verification, so its account limit protects this device workspace only; it is not a cloud identity boundary.
- Do not treat client-side gates or browser-local trading data as secure multi-user subscription enforcement. Before paid plans launch, connect Supabase Auth to a trusted server/API, validate JWTs, enforce entitlements and account limits there, move premium history to private storage, and process verified/idempotent provider webhooks server-side.

## Replay range policy

The permitted range is derived from the actual dataset's `first_timestamp` and `last_timestamp`. Purple can replay from `max(first_timestamp, last_timestamp - 365 days)` through the dataset end. Red can use the full available range. This UI/API policy does not prevent downloading public GitHub Pages assets directly.
