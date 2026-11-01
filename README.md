# Red-XAI Bridge (RedXDexAiBridge)

## Version 0.10.8 release candidate

Windows x64 and Linux x64 installers are built and verified by native CI on a version tag. Windows is a per-user, single-click NSIS setup; Linux has AppImage and Debian packages. They are distributed as a **prerelease** until signing and additional external-client compatibility work are complete. The Windows executable is not yet Authenticode signed. Source and UI tests run on macOS, but a new signed and notarized macOS installer is not included in this candidate; do not confuse source checks with installation certification.

**When a cloud AI reports an internal connection failure:** open Bridge → AI connections, make sure the remote state is verified Online, and copy the currently displayed HTTPS MCP address. Confirm that its OAuth resource metadata is reachable. Reconnect the AI in the cloud client through OAuth and approve the new request in Bridge. If the app uses a separately registered plugin tunnel, its connector may require repair or re-linking outside the desktop Bridge; a working local gateway alone does not fix an independently broken plugin registration. The bundled temporary Cloudflare URL may change on restart. A stable owned relay is required to avoid repeating that pairing after a URL change.

## One-click connection setup (Windows / macOS / Linux)

The Overview page offers **One-click setup and start at sign-in**. In an installed app, this starts the authenticated local MCP gateway, runs desktop-readiness checks and registers the app for login startup, so local AI clients can reconnect after a reboot. The button is the user's affirmative choice to enable startup. It never grants OS-level privacy consent, bypasses a lock screen, or enables unsandboxed terminal access.

On **AI connections**, **Add a new AI in one click** configures Codex CLI, Claude Desktop, VS Code, Cursor or Gemini CLI. Each local client gets a distinct, revocable credential and a backed-up configuration. Gemini CLI uses the user-level `~/.gemini/settings.json`; project settings may override it. **Other local MCP AI** generates a loopback-only HTTP endpoint and one-time bearer token to paste into an external client's configuration. **Remote ChatGPT / MCP AI** starts an HTTPS tunnel and *waits for public endpoint verification* before displaying a usable URL; the UI updates automatically while the tunnel comes online. Remote pairing still requires OAuth consent and a local approval. A temporary tunnel URL can rotate after reconnect, so remote clients may need its replacement URL.

Remote auto-reconnect is remembered **only** after the user explicitly starts a remote connection, and cleared when the user stops it. Merely enabling launch at login never opens a new remote tunnel. New AI permissions default to **Ask**, not Always Allow. All per-client permissions, approvals and the emergency stop remain effective.

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
