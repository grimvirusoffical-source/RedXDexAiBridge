# Red-XAI Bridge 0.10.2

## Background and simultaneous AI connections

- Native macOS/Windows login startup and managed Linux freedesktop autostart, without overwriting custom user entries. Failed startup registration does not make the app unlaunchable.
- Optional quiet startup in the system tray/menu bar, alongside the existing keep-running-on-close setting.
- Global or per-client background-only policy for direct tools. It blocks mouse, keyboard and app-launch/focus calls while leaving approved file, terminal and screen tools available.
- This policy is not a filesystem or OS sandbox: a client with terminal permission can run programs that affect the desktop. Use a separate Cloud PC/virtual session for genuine independent graphical desktops.
- Total and per-AI process/request limits are configurable. A value of zero removes the application-imposed cap for that setting; available CPU, memory and operating-system resources remain finite. Default quotas protect the machine and let other clients retain their own slots.
- Each authenticated AI retains its own process sessions and permissions. One AI cannot read, feed or terminate another AI's terminal process.
- Direct input/app actions hold an exclusive 30-second idle desktop lease, so two AIs do not interleave clicks and keystrokes. `desktop_release` releases only the caller's lease. `desktop_lease_status` reports availability without identifying another client.
- Emergency stop and client revocation override permissions and reset desktop ownership.

## Vortex and other clients

The existing configurable Vortex inference endpoint, encrypted API-key storage, default Pro selection and standards-compatible API calls are preserved. A new Vortex MCP export creates a separate local Vortex client, preserving its own permissions. The export contains a local credential-file reference, not an API token. It works with Vortex's MCP JSON import; configure the new client's permissions in Bridge.

The remote bridge continues to support authenticated Streamable HTTP/OAuth and explicit manually paired Bearer credentials. Local clients use the packaged stdio adapter. API access to a model does not itself grant computer-control permissions.

## Verification completed in the repair checkout

51 tests passed, including 20 concurrent isolated process sessions, configurable quotas, background-policy enforcement, desktop ownership and previous OAuth/filesystem/security tests. Source UI smoke test: version 0.10.2, nine navigable pages, 23 tools, authenticated local gateway and no renderer errors.

## Release signing

The macOS packaging process requires the configured Developer ID signature. A notarization hook can use an explicitly supplied notarytool Keychain profile through REDXAI_NOTARY_PROFILE, APPLE_NOTARY_PROFILE or APPLE_KEYCHAIN_PROFILE. It accepts only Apple's Accepted status, staples and validates the resulting app and checks Gatekeeper. Credentials are not read into project files or bundled. Without a profile, the local verification report says not-submitted; setting REDXAI_REQUIRE_NOTARIZATION=1 makes that condition fail the build.

A passing source test or successful signature is not proof of notarization, installation, update delivery or Windows/Linux runtime behavior. Report those checks separately from their actual results. The VPS quick-tunnel address is still not a permanent custom domain.
