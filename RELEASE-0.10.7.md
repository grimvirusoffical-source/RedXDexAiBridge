# RedXDexAiBridge 0.10.7 — Reliable one-click remote AI connection

Builds on the native Windows and Ubuntu-tested 0.10.6 release.

## Corrections
- One-click Add remote AI now waits for phase=online with a valid verified HTTPS MCP resource URL. It no longer rejects temporary tunnels immediately because the URL has not arrived yet.
- Remote access preference remoteAutoConnect is saved only after explicit user action, and restored after bridge restart. Explicit Remote Stop / Gateway Stop disables the preference.
- Windows login start includes the remote connection flag only when the user enabled remote auto-connect and no stable managed tunnel identity is configured. The current 0.10.5 startup/recovery behavior is otherwise preserved.
- Emergency STOP blocks automatic remote connection on restart.
- The bridge continues to support Codex CLI, Claude Desktop, VS Code, Cursor and generic local MCP through one-click configuration, individual credentials, and per-client Ask permissions.

## Verification
- 67 local test cases passing, one Windows-skipped Linux symlink test, zero failures.
- Windows packaged GUI smoke including remote setup controls and generic client creation.
- Native Ubuntu X11 Unicode keyboard, mouse/screenshot smoke and AppImage/Deb CI packaging.
- Do not claim Windows and Linux release ready until native CI jobs succeed for the 0.10.7 commit.

## Important consent boundaries
No remote or OS computer-control permissions are granted automatically. The user approves ChatGPT and other remote AI OAuth pairing separately, and a temporary Cloudflare URL may change after reconnecting. Linux Wayland global input is not supported; use X11 for desktop control.
