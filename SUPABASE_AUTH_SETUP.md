# Supabase Auth setup for intensefxTRADES

The static GitHub Pages build can use Supabase Auth for real email/password and Google sign-in. The browser receives only the Supabase project URL and public anon/publishable key. Never place a service-role key, database password, or Google OAuth client secret in this repository.

## Configure the project

1. Create a Supabase project and run `supabase/migrations/202610240001_auth_profiles_and_free_plan.sql` in its SQL editor.
2. In **Authentication → URL Configuration**, set the site URL to `https://prog-anshu36.github.io/intensefxtrades/`. Add that exact URL to the redirect allow list. Add your localhost preview URL while testing.
3. In **Authentication → Providers → Email**, enable email/password and email confirmation. Set the confirmation and password-reset email templates to send users back to the Pages site.
4. To enable Google, create an OAuth client in Google Cloud. Add `https://<project-ref>.supabase.co/auth/v1/callback` as its authorized redirect URI. Add `https://prog-anshu36.github.io` as an authorized JavaScript origin. Put the Google client ID and client secret only in Supabase's Google provider settings, then enable that provider.
5. Set the `supabaseUrl` and public `supabaseAnonKey` fields in `frontend/static/js/auth-config.js`. The URL is the project HTTPS URL. The anon/publishable key is public and is safe to serve; RLS is the security boundary. The app intentionally has no client secret.
6. Deploy the Pages build and test email verification, sign-in, OAuth callback, password reset, profile update, and sign-out over HTTPS.

The OAuth callback URI registered with Google is the Supabase callback above. The final redirect back to the app is `https://prog-anshu36.github.io/intensefxtrades/`, which must be allow-listed in Supabase. For local testing, add the exact local origin and callback to Supabase's allow list.

## What the migration enforces

The trigger creates a profile and a separate `blue` / `active` subscription row for every new Auth user. RLS allows an authenticated user to read only their own profile and subscription. A user can update only their profile name; client roles cannot insert, update, or delete subscription rows. Paid plan changes therefore still require a trusted server/payment webhook and are not implemented by this browser-only migration.

## Current limits

The app's trading workspace continues to use IndexedDB in the current browser. Authentication does not sync trades, journals, chart drawings, or settings to the cloud, and signing in from a different device will not restore them. The local Pyodide/Flask compatibility runtime is not a trusted hosted API. Do not treat its local login routes or browser storage as authorization for private data. This setup does not yet enforce subscription permissions on trading features or protect public CSV files. Those require a server-side data and entitlement layer.

The included `frontend/static/legal.html` is a factual product-notice draft and needs owner review before registration is opened to the public.
