# Prepaid payments and bank settlement

Approved prices in INR: Blue 0; Green 49/month; Purple 149/month; Red 199/month; Golden VIP Pass 249/month. Three months costs 3× and annual 12×. No discounts, recurring mandates, or automatic renewal are configured. Golden VIP is a separate pass with all supported Red entitlements and a gold label, not a fifth plan card. Same-product renewals extend remaining access; switching product starts a new term without prorating. Lower-tier purchases are blocked while a higher tier remains active.

## Deployed but not accepting payments

The Supabase `billing` Edge Function and RLS-protected billing schema are installed. Checkout remains disabled unless BILLING_ENABLED=true AND all provider secrets are configured. A missing setup returns 503 and never opens the payment widget. No merchant account, test payment, live payment or bank settlement has been created or performed by the agent.

Create a Razorpay merchant account yourself and complete its activation/KYC and settlement-bank setup. Do not send bank details, database passwords or private keys in chat or commit them to GitHub. Razorpay pays captured funds to the approved settlement bank after applicable fees, according to its settlement schedule.

## Supabase Edge Function secrets

Store through Supabase Dashboard → Edge Functions → Secrets:

- RAZORPAY_KEY_ID (test key first; live key only after launch checks)
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET (separate from the API secret)
- BILLING_ALLOWED_ORIGIN=https://prog-anshu36.github.io
- BILLING_ENABLED=true only after the readiness checks below

SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are platform-provided Edge Function secrets. They are never shipped to the browser. The frontend uses only the public publishable key and the signed-in user's session.

The `billing` function has gateway JWT validation disabled because `/webhook` receives provider requests. It performs its own authentication: getUser(token) for order/verify actions; HMAC-SHA256 of the original request body for webhooks. The database fulfillment function is service-role-only.

Webhook URL: https://sacckmlsdthzxkseahus.supabase.co/functions/v1/billing/webhook
Subscribe to payment.captured. Use the separate webhook secret above, and automatic capture in the Razorpay dashboard.

The server computes prices, creates the provider order, stores its signed-in owner, verifies signatures and fetches the captured payment directly from Razorpay. Currency, amount and order must match. The browser success callback never grants access. A transactional fulfillment RPC locks the purchase and subscription, sets the paid calendar-month expiry, and writes history exactly once. Webhook redelivery and repeated client verification cannot extend access twice.

## Tests actually performed

- Unit tests for twelve product/term combinations and matching frontend/server quotes.
- Golden VIP full entitlements and expiration fallback.
- HMAC acceptance/rejection, wrong currency/amount/order, authorized-only and refunded payment rejection.
- Checkout mocks: server-priced request, verified refresh, no activation from success alone, missing-merchant failure.
- Rollback-only database test: three-month Golden maps to Red, duplicate fulfillment records one history entry, clients cannot forge purchases or invoke fulfillment.
- Live function returns 503 while unconfigured.

## Required before enabling real sales

- Verified merchant account and settlement bank; provider approval is outside the application.
- Complete test-mode purchase, dismissal, capture delay, webhook redelivery and interrupted-checkout recovery using provider credentials. These have NOT been executed against Razorpay.
- Add refund/dispute handling and agree the merchant's refund and tax/invoice policy. Current fulfillment supports captured prepaid purchases only; it does not automatically revoke access on later refunds or disputes.
- Protect premium market files and feature APIs outside the browser. GitHub Pages historical-data chunks remain public, and the local trading runtime is not a trusted cloud authorization boundary. Paid login records do not make static premium files private.
- Configure production email delivery and Google OAuth as required; cloud trade/journal/drawing synchronization remains separate.
- Review current terms/privacy drafts and publish the business/contact/refund information required by the provider.

Source references: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/ ; https://razorpay.com/docs/webhooks/validate-test/ ; https://razorpay.com/docs/payments/settlements/

