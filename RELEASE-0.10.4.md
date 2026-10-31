# RedXDexAiBridge 0.10.4

Windows remote-recovery patch.

- Windows login startup now includes `--connect-remote`, so a configured remote connection is restored after sign-in/reboot.
- A configured VPS relay that disconnects or remains publicly unreachable now falls back to the bundled temporary HTTPS tunnel instead of retrying the dead relay forever.
- The fallback preserves the saved VPS configuration for later recovery; explicit Stop still prevents reconnect.
- No Vortex source or unrelated product repository changes are included.

Verification on Windows Shadow PC:
- `npm run check`: 56 passed, 0 failed, 1 expected Linux-only skip.
- Windows NSIS package built successfully with bundled checksum-verified cloudflared 2026.10.5.
- Installed 0.10.4 reported its local MCP runtime and verified its temporary public OAuth metadata as online.
