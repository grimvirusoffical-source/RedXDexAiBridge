# Red-XAI Bridge (RedXDexAiBridge)

A permission-controlled desktop bridge for MCP-compatible AI clients, with embedded Vortex text chat. Source and releases remain in `grimvirusoffical-source/RedXDexAiBridge`.

## Install

Use the matching package from the repository Releases page: macOS Apple Silicon DMG, Windows x64 setup executable, or Linux x64 AppImage/Debian package. Windows and Linux 0.10.1 packages are cross-built previews, not yet native-runtime-validated. The Mac package is Developer ID signed, not notarized; Windows signing is not configured.

Open the app, approve the folders you want accessible, pair each AI, and choose Deny, Ask or Always Allow separately for each client. STOP blocks new computer actions and stops managed terminals. Terminal permission is powerful and is not a filesystem sandbox. Operating-system privacy and secure-desktop restrictions remain independent of bridge permissions.

## AI connections

The app supports local Claude Desktop, VS Code, Cursor and Codex configuration with backups. The registered ChatGPT connection is paired with the owner's Mac; a different computer needs its own connection/pairing. Generic MCP clients can use the displayed authenticated HTTP endpoint. Keep the app running. OAuth approval is local and explicit; no API token is embedded in the plugin or installers.

The current owner VPS relay retains its address across Mac restarts, but a quick-tunnel server restart can rotate it. New installations can use the bundled, checksum-verified tunnel helper. This is not a permanent hosted multi-device service.

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

The Mac release passed 44 automated tests, packaged navigation checks and a real Vortex Pro request. All package dependency inventories and update hashes were checked. See RELEASE-0.10.1.md for exact limits.
