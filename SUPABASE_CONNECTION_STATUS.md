# Supabase connection status

Project: sacckmlsdthzxkseahus
Public app: https://prog-anshu36.github.io/intensefxtrades/

Connected using a publishable frontend key. No service-role key is shipped.
Applied the three repository migrations: profiles/free plan, subscription lifecycle, secure VIP redemption.

Verified:
- Public Auth settings endpoint returns 200 with the configured key.
- Email signup enabled; email verification required.
- All five tables have RLS enabled.
- Rollback-only database test confirms profile isolation, automatic Blue subscription, and denied client subscription/ownership updates.
- Authentication UI regression test passes, including visible password reset fields.

Still required:
- Google provider is disabled. Configure its OAuth credentials in Supabase; callback https://sacckmlsdthzxkseahus.supabase.co/auth/v1/callback.
- Test real email verification and sign-in using an owner-controlled account. No user registration or password was created by the agent.
- Configure custom SMTP for public delivery requirements; default Supabase mail has restrictions.
- Trades, journals, drawings and chart state remain browser-local. This connection does not implement cloud workspace synchronization, payments, protected CSV delivery or backend enforcement of every chart entitlement.
- Existing anonymous browser data is retained but is not automatically imported into a signed-in user's separate workspace.

Site URL / redirect URL were confirmed saved by the owner to the public app URL. See SUPABASE_AUTH_SETUP.md for setup details.
