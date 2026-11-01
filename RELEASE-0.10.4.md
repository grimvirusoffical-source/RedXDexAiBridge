# RedXDexAiBridge 0.10.4 — Cross-platform one-click setup

## Changes

- Windows NSIS installer now uses the one-click, per-user install flow. No automatic UAC or privacy bypass and no deletion of user bridge data during uninstall.
- One-click setup for this computer checks the authenticated gateway and OS desktop-input readiness from the app without silently granting AI permissions.
- Add a new AI supports local Codex CLI, Claude Desktop, VS Code and Cursor MCP configurations with backups. A custom local MCP AI receives its own individually revocable, one-time bearer token, localhost-only MCP URL and Ask permissions. A remote AI uses an HTTPS endpoint with OAuth and requires pairing approval. The app does not silently pair external services or expose credentials as a query string.
- Linux packaging now automatically prepares the pinned, checksum-verified tunnel helper before building AppImage/Deb packages.
- Linux readiness distinguishes X11 with xdotool, Wayland (portal screen capture but no global input injection) and headless sessions. It reports missing prerequisites rather than pretending OS permissions can be granted automatically.
- Additional pure setup/credential tests and a graphical smoke check for the new setup IPC/UI.

## Verification

Windows: run npm run check, npm run prepare:native, npm run prepare:tunnel, the isolated Electron GUI smoke test, and npm run package:win. Only call a test successful after it exits with status 0 and outputs are inspected.

Linux: the pull-request GitHub Actions workflow has a native Ubuntu 24.04 runner with Xvfb, xdotool, a graphical smoke test, tunnel preparation, AppImage and Deb packaging. Confirm the run status before claiming native Linux validation.

## Limits

- Windows current interactive session only; protected desktops/UAC and elevated UI are not bypassed.
- Linux global mouse/keyboard control uses X11. Wayland requires a consented portal for screen capture but global Wayland input remains unimplemented.
- A private, temporary HTTPS tunnel URL is not a permanent address and may change after a tunnel restart, requiring users to reconnect remote services.
- Client configuration requires the target application to be installed, and all computer permissions remain denied or Ask until explicitly approved.
- This version has not been signed with a Windows code-signing certificate unless a verified signed artifact is produced.

## Rollback

Keep a copy of the current 0.10.3 Windows installer and user bridge data before upgrading. Existing approval policy and client secrets are stored outside the application folder. If the new version fails its tests, do not replace the working installation.
