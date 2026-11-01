# Red-XAI Bridge (RedXDexAiBridge)

## One-click connection setup (0.10.4)

The Overview page now has **One-click setup for this computer**. It checks the local authenticated MCP gateway and reports the active Windows/macOS/Linux desktop input state. It does **not** grant OS-level privacy consent, unlock an OS, or activate AI permissions without approval.

On **AI connections**, **Add a new AI in one click** configures local Codex CLI, Claude Desktop, VS Code, or Cursor with an individual backed-up MCP configuration. **Other local MCP AI** creates a separately revocable credential and displays a loopback-only HTTP MCP URL and bearer token once; you paste these into the AI service, never a public tunnel. **Remote ChatGPT / MCP AI** starts the HTTPS tunnel and displays an OAuth connection URL; you still approve pairing in the remote service and in the Bridge. The UI will not embed an authentication token in a remote URL. New AI permissions default to **Ask**, not Always Allow.

The Windows NSIS installer is now one-click per-user installation, without changing operating-system permission prompts. The Linux package script now first bundles the checksum-verified tunnel helper; the Debian installer declares `xdotool` and desktop dependencies. Linux X11 + xdotool supports global input when authorized. Wayland may offer screen capture via the desktop portal but does **not** provide global mouse/keyboard injection; choosing X11 is required for that capability. Native Linux CI validation is required before declaring a release fully tested on Linux.


A permission-controlled desktop bridge for MCP-compatible AI clients, with embedded Vortex text chat. Source and releases remain in `grimvirusoffical-source/RedXDexAiBridge`.

## Install

Use the matching package from the repository Releases page: macOS Apple Silicon DMG, Windows x64 setup executable, or Linux x64 AppImage/Debian package. The Windows 0.10.3 repair was built, installed and tested on a Windows Shadow PC; see RELEASE-0.10.3.md for the checks and remaining permission handoff. Its local installer is not a published GitHub release. The Linux 0.10.1 package remains a cross-built preview without native runtime validation. The Mac package is Developer ID signed, not notarized; Windows signing is not configured.

Open the app, approve the folders you want accessible, pair each AI, and choose Deny, Ask or Always Allow separately for each client. STOP blocks new computer actions and stops managed terminals. Terminal permission is powerful and is not a filesystem sandbox. Operating-system privacy and secure-desktop restrictions remain independent of bridge permissions.

## AI connections

The app supports local Claude Desktop, VS Code, Cursor and Codex configuration with backups. Each computer needs its own authenticated ChatGPT connection and pairing. The Windows Shadow PC connection is separate from the Mac connection. Generic MCP clients can use the displayed authenticated HTTP endpoint. Keep the app running. OAuth approval is local and explicit; no API token is embedded in the plugin or installers.

The current owner VPS relay retains its address across app restarts, but a quick-tunnel server restart can rotate it. New installations can use the bundled, checksum-verified tunnel helper. This is not a permanent hosted multi-device service.

## Vortex chat

Set the actual API base address, save a `redx_ai_` or `redx_xai_` key, and test it. Use **Use local Vortex gateway** for an existing gateway at `http://127.0.0.1:18091/v1`, or enter a reachable HTTPS endpoint you own/trust. The local service/tunnel must be running. The bridge never follows API redirects with your key and asks before changing the destination.

An admin label is not a reason to reject a correctly formatted Vortex key; privileges and model access are checked by the server. Pro (`vortex-pro`) is the default. No weaker model or alternative endpoint is silently selected. The embedded interface is text chat and model discovery, not a replacement for every Vortex application feature. Compatible editor extensions can use the same endpoint/model/key; the bridge's **Copy VS Code settings** action deliberately omits the secret.

Keys are encrypted with the OS credential service. Linux needs a working secret-service/keyring; the app does not fall back to plaintext key storage.

## Platform controls

macOS uses the signed Swift helper and requires Accessibility/Screen Recording consent. Windows uses Win32 input on the current interactive desktop; UAC, lock screens and higher-integrity applications are not bypassed. Native Windows builds prefer the compiled C# helper; cross-built previews include the PowerShell/Win32 backend. Linux global input requires X11 and `xdotool`; Wayland screen capture may use a portal, but global Wayland input is not implemented.

## Updates

The installed app shows its current version. Updates are delivered from published GitHub release assets, not arbitrary source commits. The private feed requires GitHub authorization through Settings. A release includes per-platform update manifests, blockmaps where applicable, and checksums.

## Development and verification

Use Node 24, `npm ci`, `npm run check`, `npm run prepare:native`, and `npm run prepare:tunnel`. Build with `npm run package:mac`, `npm run package:win` or `npm run package:linux` on the appropriate OS. The GitHub workflow includes native GUI/input tests, but its hosted jobs were unavailable during the 0.10.1 release; do not infer a pass from the workflow's presence.

The 0.10.1 Mac release passed 44 automated tests, packaged navigation checks and a real Vortex Pro request. All package dependency inventories and update hashes were checked. See RELEASE-0.10.1.md for those historical limits and RELEASE-0.10.3.md for the Windows repair and its native verification results.
