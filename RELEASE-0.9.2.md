# RedXDexAiBridge 0.9.2

## Connection repairs

- Added an isolated VPS-backed SSH reverse-forwarding transport. The application uses a dedicated forwarding-only SSH identity, strict known-host checking and loopback-only remote forwarding.
- Added public OAuth metadata health checks. A logged tunnel URL is no longer enough to display Online.
- Added SSH reconnect with bounded backoff, transport status and automatic connection from protected local relay preferences.
- A Mac app restart retains the VPS tunnel address. The VPS currently uses a Cloudflare quick tunnel: restarting that VPS service can rotate the address. This is not a permanent custom domain.
- Added public schema-only MCP discovery. Every computer tool, including status and profile, still requires verified credentials. Invalid credentials are not downgraded to anonymous access.
- Added explicit OAuth security metadata, authentication challenges, and an authenticated stable connection-profile tool.
- Added one-click Codex configuration through the official Codex CLI. Existing configuration is backed up, and Codex uses its own bridge credentials rather than Claude's.
- Preserved per-AI Deny / Ask / Always Allow, local pairing consent, emergency stop, approved folders, and all existing tools. Vortex integration is unchanged.

## Verification at packaging

34 automated tests passed on the Mac. Syntax checks passed. The desktop smoke test showed version 0.9.2, 21 tools, nine pages, a working local gateway, and no renderer errors.

The macOS application is Developer ID signed. Apple notarization has not completed: the available App Store Connect key returned HTTP 401 during credential verification. Live computer-control tests and a full automatic upgrade must be reported from their actual results, not inferred from these tests.

Private update downloads require the user's GitHub authorization already available in the app Settings. No OAuth tokens, GitHub credentials or SSH private keys are packaged in this release.
