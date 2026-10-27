# RedXDexAiBridge 0.9.0 — signed Mac testing release

## Implemented
- Full nine-page desktop control center and 20 MCP tools.
- Authenticated local connections; per-client credentials and revocation.
- Ask/Allow Once/Always Allow/Deny, approval queue, emergency stop and managed processes.
- OAuth authorization with PKCE and rotating refresh tokens for remote MCP clients.
- On-demand temporary HTTPS tunnel through an installed cloudflared client.
- Native Apple Silicon input helper and screen-capture integration.
- One-click local Claude Desktop, VS Code and Cursor configuration; local ChatGPT plugin pairing.
- Private GitHub release checks, automatic-download preference and restart/install controls.

## Verification
28 automated checks pass on macOS arm64. Native Swift helper compiles. GUI smoke test reports nine pages, version 0.9.0, 20 tools, online local gateway and no renderer errors. Production dependency audit reports zero known vulnerabilities at build time. This is not an independent security audit.

## Important limitations
Developer ID signing is separate from Apple notarization: this release has NOT been submitted for notarization. The temporary remote endpoint changes on restart and is not a permanent hosted relay. ChatGPT cloud connection/consent and macOS privacy permissions cannot be skipped. Private update access requires signing in to GitHub in Settings. An actual upgrade from a previously signed release has not yet been verified. Windows/Linux installers and Vortex service changes are not part of this release.
