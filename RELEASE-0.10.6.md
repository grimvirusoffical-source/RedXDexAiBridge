# RedXDexAiBridge 0.10.6 — Windows upgrade-safe one-click client setup and Linux fixes

The Shadow PC's existing Windows bridge is version 0.10.5, newer than the original 0.10.4 repair build. This 0.10.6 package includes those previously installed 0.10.5 startup/tunnel changes as well as the independently tested 0.10.4 cross-platform and setup fixes.

## Included

- One-click, per-user Windows NSIS installer that retains the user's data; no UAC/privacy bypass.
- One-click in-app setup to check authenticated MCP gateway and native desktop readiness.
- One-click per-client integration flow for local Codex CLI, Claude Desktop, VS Code, Cursor, generic local HTTP MCP and remote OAuth clients.
- Per-client revocable credentials; permission policy defaults to Ask and STOP overrides all control.
- Windows login startup honors a managed persistent tunnel identity or reconnects a temporary tunnel when previously configured.
- Previously installed VPS relay failure fallback behavior preserved and now covered by regression tests.
- Linux X11 UTF-8 Unicode typing fix; no shared clipboard, shell interpolation or Wayland security bypass.
- Linux AppImage/Deb packaging prepares pinned checksum-verified tunnel before build.

## Validation

- Windows native helper and packaged Electron GUI smoke, quick setup/credentials and Windows NSIS installer checks.
- Linux Ubuntu 24.04 Xvfb/xdotool GUI and native tests, Unicode typing, and AppImage/deb package checks in GitHub Actions.
- Do not claim release complete until both jobs and artifact checks succeed for the 0.10.6 commit.

## Deployment considerations

- Installer is unsigned until a verified Windows code signing certificate is configured.
- If the remote temporary HTTPS URL changes after an upgrade, connected MCP clients must reconnect; OAuth approval cannot be silently granted.
- Linux Wayland globally injected mouse/keyboard input remains unsupported; the X11 desktop is required.
- Existing local bridge settings, encrypted secrets, approvals, and user-managed terminals must be preserved.
