# Red-XAI Bridge 0.10.19 — manual sign-in

Manual sign-in uses the canonical Red-XAI account service and recognizes its authenticator/phone-call availability in the same way as the website. Phone verification includes an explicit call request and a Back action to cancel the current challenge.

Accounts can sign in without an extra client-imposed verification step when the account service completes password authentication directly and returns a fresh authenticated session. If the service requests MFA or setup, that challenge remains required.

Secure cookie and account deadlines remain separate. Session-only credentials stay in memory; remembered credentials use encrypted storage and short server revalidation. Cancellation and refresh guards protect newly verified sessions, and password/code fields clear after use. Existing Quick Login, saved clients and device settings are preserved.

Validation must include the resulting hosted Windows/Linux checks, real canonical sign-in, release-artifact checks and the existing live Quick Login publication guard before stable promotion. This update does not enable the separate 0.11 shop/platform preview.
