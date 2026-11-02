# Red-XAI Bridge v0.10.15

Red-XAI Bridge 0.10.15 adds a mandatory Red-XAI account sign-in gate to the desktop application, and carries forward the 0.10.14 permission and interface improvements.

## Changes
- New first-launch login window: Red-XAI Quick Login with PKCE browser approval, plus manual Red-XAI email/username and password login with a server-controlled second-factor challenge.
- Unauthenticated desktop launches keep the local MCP gateway disabled. Renderer IPC and MCP HTTP requests enforce independent authentication gates; no remote MCP client receives device-control access solely from Red-XAI account sign-in.
- Existing device-scoped OAuth client registrations, per-tool approvals, emergency STOP and settings remain in place.
- Sign out from Settings to stop running MCP connections and managed processes, without revoking unrelated Red-XAI apps.
- Optional Red-XAI CLI release link on the sign-in screen and in Settings.
- Locked-out users can still check, download and install a newer verified Bridge release to recover from authentication-service problems.
- Added development resources for user-app registry numeric ID 6 in RedX, retaining the original Red-XAI user subject; no changes to RedX or Red-XAI Accounts database-engine code.
- Test coverage for signed-out MCP, account scope validation, 2FA and login-window package contents.

## Deployment and service prerequisites
- The Quick Login repository now includes first-party client 'bridge' with scope 'bridge.app', but its server deployment must be completed for the Quick Login button to work in production. In the meantime, the existing manual Red-XAI account sign-in service is available.
- The numeric ID 6 central account-usage records are a server-side provisioning/migration proposal. Production table creation and event recording have NOT been performed; the included utility is dry-run by default and needs an authorized scoped server credential.
- The optional CLI release link points to red-xai-installers releases. Public installer availability has not yet been verified.
- Persistent named Cloudflare Tunnel mode and local-only MCP mode are included. A named tunnel requires the owner to configure a hostname and Cloudflare YAML outside the app; the release does not automatically provision Cloudflare DNS or tunnel credentials. Temporary quick tunnels still change address when restarted.
- Windows installation packages are unsigned until a code signing identity is configured. macOS app packaging is separately gated on signing/notarization.

## Release verification
Windows source suite, the original GUI smoke, signed-out GUI smoke, packaging, Electron ASAR contents and updater latest.yml were checked locally. Cross-platform CI must pass before the stable GitHub release is marked available.
