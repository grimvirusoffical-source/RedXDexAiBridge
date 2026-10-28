# RedXDexAiBridge 0.9.3

This release preserves the 0.9.2 connection repair and fixes screen-permission diagnostics discovered during live testing.

- The Desktop page checks Screen Recording authorization for the signed Electron application itself, rather than treating a helper-process permission as proof of capture access.
- Screen-capture failures explain how to grant the correct app permission and restart without weakening macOS controls.
- The cloud plugin is now bound to the registered private RedXDexAiBridge Remote App, created through ChatGPT's custom-MCP interface. Pairing still requires the user's approval on the Mac.
- Local Codex, Claude Desktop, VS Code and Cursor setup, VPS reconnection, per-AI permissions and emergency stop remain unchanged.
- Vortex integration was not modified.

## Verified

36 automated tests and syntax checks pass. The native GUI smoke test shows version 0.9.3, 21 tools, nine pages and no renderer errors. The previous installed 0.9.2 application passed ten live file/terminal tests through its packaged MCP adapter. Non-interactive keyboard helper validation passed; screen capture was blocked/unavailable in the actual signed app and must be retested after the appropriate OS permission is granted.

This release is Developer ID signed, not notarized. The available notarization credential returned HTTP 401. A full automatic upgrade cycle is not yet verified. The isolated VPS currently uses a Cloudflare quick tunnel; Mac app restarts retain the address, but restarting the VPS tunnel service may rotate it. No credentials or private keys are included in the release.
