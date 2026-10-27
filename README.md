# RedXDexAiBridge 0.9.0

AI-independent desktop bridge for macOS. Existing Vortex API integration is preserved; this release does not change any Vortex, RedX, Accounts, Quick Login or encryption repository.

## Implemented

- Electron control center: working navigation, version, gateway, clients, permissions, approvals, file editor, managed terminal, screen preview, session activity, preferences and update controls.
- Client-bound bearer tokens. Each client is separately revocable; client names or environment variables sent over HTTP cannot impersonate another client.
- Ask / Allow Once / Always Allow / Deny. Approvals occur in the desktop app, time out, and are cancelled by emergency stop. Always Allow is persistent per client and capability.
- File roots and symlink checks; protected bridge policy/credential folder; recoverable trash; filename search and size sorting.
- Per-client process start, output, stdin, list and stop. Emergency stop blocks new actions and stops bridge-managed terminals.
- Native macOS mouse movement, click, double/right click, drag, scroll, Unicode typing and keyboard shortcuts. Native helper is compiled before packaging, not in /tmp during a tool call.
- Streamable HTTP JSON responses, OAuth authorization-code + S256 PKCE, dynamic client registration, local desktop pairing approval, scoped/audience-bound tokens, refresh rotation and replay detection.
- One-click temporary HTTPS tunnel using an already installed official cloudflared client.
- Local MCP setup for Claude Desktop, VS Code user-level configuration, Cursor, and a local-execution ChatGPT plugin. Existing client settings are backed up.
- Bundled runtime for installed-app stdio clients. Source use requires Node 22+.
- Electron updater wired to private GitHub releases, with optional locally encrypted GitHub authentication, automatic downloads, version and restart/install controls.
- Menu-bar lifecycle, optional launch at login, single-instance guard and trusted-renderer IPC checks.

## Important boundaries

The temporary tunnel URL changes when it is stopped/restarted. This is NOT a permanent hosted relay; remote clients then need their URL updated and must pair again. ChatGPT's own plugin connection/consent step cannot be skipped. A local plugin requires a client that supports local MCP execution.

Always Allow does not bypass macOS permissions. Terminal access is not sandboxed by its working directory. Only grant it to clients you trust. Platform-level confirmation policies may still apply independently of the bridge's permissions.

A source build is not a notarized installer. Apple notarization and update installation must be separately verified on the built artifacts. The checked-in build configuration does not silently claim notarization. A Developer ID signature is distinct from a notarization ticket.

## Develop

```sh
npm install
npm run prepare:native
npm run check
npm start
```

Tests use an isolated temporary settings directory and never replace the user's real bridge permissions. `npm run check` includes JavaScript syntax and automated tests.

## Build on a Mac

```sh
npm run package:mac
```

The build requires the configured Developer ID identity. Source and releases are private. Do not bundle a GitHub PAT, OAuth token, Apple private key, or user credentials. Configure a notarization keychain profile locally before a notarized release. For automatic updates, publish the generated macOS ZIP and update metadata together after validation.

## Explicit startup options

`--pair-local-chatgpt` prepares a local plugin credential with Ask permissions. `--connect-remote` starts the authenticated HTTPS tunnel for this launch. Neither option grants computer-control permissions. macOS consent remains separate. Saved Vortex credentials retain the existing `redxdex-ai-bridge` application-support location.
