# Red-XAI Bridge Account Integration — App 6

Status: development branch only. NOT a login-gated installer, live user database migration, or released v0.10.15.

## Existing identity systems

Red-XAI Quick Login at https://red-xai.com/redxai-connect uses the shared verified Red-XAI website account identity, browser approval, PKCE S256, and per-app tokens. This branch's separate Quick Login integration declares a first-party public client named bridge with scope bridge.app. Deployment and validation of that client on the production website must happen before Bridge's sign-in UI is enabled.

Manual Red-XAI login uses https://api.red-xai.com/v1/accounts/ and accepts email/username plus password. The website service, not the desktop, determines whether an OTP or SMS challenge is required. Quick Login does not require the user to repeat 2FA in the Bridge when they already have a valid website session; it never bypasses website 2FA itself.

The optional Accounts OIDC provider is documented in red-xai-accounts but production issuer/registration still require verification. Do not mix identities from these two services merely because emails match.

## Gate required before publishing a login-required Bridge

1. Render only a sign-in screen before authenticated startup. All privileged Electron IPC, local MCP gateway, remote tunnel, and background agent requests must fail closed until a valid Red-XAI account is confirmed online.
2. Signing into Red-XAI does NOT authorize a connected MCP client to control a PC. Maintain the existing, separately revocable device-bound OAuth pairing, owner approvals, per-client permissions, and emergency STOP.
3. Never transfer previous device approvals to another Red-XAI account. Lock the gateway and revoke only this application's credentials on sign-out. Preserve other apps' sessions and credentials.
4. Store application refresh credentials only in the OS encrypted credential store, except Quick Login remember_device=false, which must remain memory-only. Never persist password, OTP, PKCE verifier, authorization fragment, or website cookies.
5. Test Windows/macOS/Linux GUI, remote/local MCP, failure/recovery and update flows before release.

The main Electron startup, login page, privileged IPC gate and MCP HTTP gate are now integrated. Signed-out Windows GUI and direct HTTP security smoke tests passed; complete production login verification still depends on deployment of the Bridge Quick Login client and the existing Red-XAI Accounts service.

## Numeric application registry

Reserve app IDs 1-5. Red-XAI Bridge uses numeric appId 6, while each user's canonical Red-XAI subject remains its original string ID.

Proposed RedX records inside existing redxai_accounts DB:
- rxa-app-registry.red-xai.db:App[ID=6] — app metadata
- rxa-user-apps.red-xai.db:Schema[ID=6] — usage table metadata
- rxa-user-apps.red-xai.db:UserApp[ID=<numeric-row-key>] — one per verified user/app.

The usage row key is the first 52 bits of SHA-256 of verified account-subject + NUL + app ID. Each row must retain the full subject for collision checks. Suggested columns: accountSub, appId, firstUsedMs, lastLoginMs, lastUsedMs, loginCount.

The scripts/provision-app-six.cjs server-side provisioning tool is dry-run by default; --apply explicitly initializes only two new metadata records, and never overwrites existing records. A trusted backend, using a scoped RedX key and verified auth token, must implement actual usage upserts. Do not ship database credentials to client installations. No production database mutations have been performed. No code in RedX or red-xai-accounts is altered.

## CLI download

The accessible REDXAI CLI source is in the private red-xai-installers repository. At last inspection it had no published GitHub Release artifacts; npm publication was not verified. Add optional CLI download from login and Settings only after verifying publicly accessible trusted packages and their checksums, with explicit user consent. Do not claim an installer exists when one has not been published.

## Tests

Run node --test test/redxai-auth.test.cjs test/app-registry-six.test.cjs. Passing unit tests does not establish GUI sign-in gating, live database writes, or a released installer.
