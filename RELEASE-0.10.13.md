# RedXDexAiBridge 0.10.13 — Copy your PC connection into ChatGPT

## One-click PC-to-ChatGPT connection handoff

- The Bridge creates an HTTPS tunnel directly from the computer when the owner clicks **Create HTTPS link on this PC**. Previously enabled remote connections also auto-start on Bridge launch.
- The remote endpoint is verified against its own OAuth protected-resource metadata before any ChatGPT copy action becomes available.
- When the verified endpoint is ready, the **AI connections** page enables **Copy for ChatGPT**. The overview displays a reminder and, when supported by the OS, the installed app sends a one-time connection-ready notification for each new URL.
- Clicking the button copies a short request to update the **existing private Red-XAI Bridge plugin** with the current URL while preserving OAuth authentication, settings, pairing consent and permissions. No API key, client token, or private credential is copied.
- The existing **Copy MCP URL** action remains available for MCP clients that accept a plain URL.
- The one-click **Remote ChatGPT / MCP AI (OAuth)** setup flow also uses the ChatGPT-specific copy action.

## What this does and does not do

The copied message is a handoff for ChatGPT to update the private plugin configuration; **pasting it is not an automatic MCP configuration update**. ChatGPT must have authorization and available plugin-editing tools to update that existing plugin. New or renewed OAuth authorization can still be required.

A temporary Cloudflare tunnel's hostname may change when the app or tunnel restarts. The new verified address must be copied into ChatGPT and applied to the plugin. For permanent URLs, use a separately configured owner-controlled relay or domain; this release does not automatically provision a stable hostname, bypass device security, or start a computer that is turned off.

If the app is running with remote access previously enabled, it can generate its tunnel again without new installer dependencies. If remote access was disabled, the user must enable it first.

## Verification

Cross-platform source tests verify a valid HTTPS /mcp link, refusal to copy unverified endpoints, token-free connection instructions, URL-change handling and the app/renderer connection controls.

The Windows and Linux CI build/GUI checks and macOS native helper checks must pass before release publication. No new signed/notarized macOS distribution is supplied by this workflow.
