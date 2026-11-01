# RedXDexAiBridge 0.10.8 — Windows/Linux installer and remote reconnection repair

## Windows and Linux installers
- Windows x64: per-user, one-click NSIS setup. Existing paired clients, permissions, approved folders and credentials are retained across installation.
- Linux x64: AppImage and Debian package. Global input requires a supported X11 session with `xdotool`; Wayland input injection is not provided.
- macOS: the source, user-level MCP setup and Swift input helper are checked on a macOS runner, but there is **no new signed/notarized macOS installer** in this release candidate. Do not claim otherwise.

## Reliability
- The local MCP gateway starts in the app and individual credentials are revocable.
- Legacy Windows remote connections are migrated to an explicit reconnect preference only when a previously active secure remote identity is confirmed.
- A user who presses Remote Stop explicitly disables auto-reconnect.
- New remote client pairing waits for the verified HTTPS MCP endpoint. Each online client still authorizes through OAuth and needs a local pairing approval; credentials are never put in remote URLs.
- One-click integration supports Codex CLI, Claude Desktop, VS Code, Cursor, Gemini CLI, generic local MCP and remote OAuth clients. Permissions remain Ask until explicitly approved.
- Windows login startup can be enabled through the Bridge UI without automatically opening remote access for a newly installed user.

## Limitations and security
- Windows binaries are currently **unsigned**. Windows SmartScreen may warn until a code-signing certificate is configured.
- A Cloudflare quick tunnel has a **temporary URL** which can change when the tunnel restarts. A stable owned HTTPS domain or relay is needed before cloud MCP clients can keep one permanent connection.
- Authenticated local MCP and verified public OAuth metadata do not establish that a particular ChatGPT plugin has been re-linked or reauthorized; perform that pairing inside ChatGPT and the Bridge app.
- The desktop bridge never silently bypasses Windows UAC, macOS Accessibility/Screen Recording consent, or the user's per-client permissions and emergency STOP.

## Validation gate
GitHub Actions must successfully run Windows unit/GUI/native/installer/hash checks, Linux X11/GUI/AppImage/Deb checks, and macOS Swift/helper unit checks before publication. The historical Windows Shadow PC installation passed its local 23-tool MCP handshake, local UI 9-page smoke test and remote OAuth metadata check; those checks are not substitutes for testing the installer on another owner's machine.
