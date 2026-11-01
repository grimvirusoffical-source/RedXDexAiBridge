# Red-XAI Bridge 0.10.1

This release uses the existing private RedXDexAiBridge repository and preserves the application's identity and saved settings.

## Packages

- macOS Apple Silicon: signed DMG and update ZIP. The installed-package UI and Vortex integration were tested on a Mac.
- Windows x64: NSIS installer with the red-X application/installer icons and embedded version metadata. This is an unsigned, cross-built preview; native Windows runtime testing is not yet complete.
- Linux x64: AppImage and Debian package with desktop entries and icons. These are cross-built previews; native Linux runtime testing is not yet complete. Global input requires X11 and xdotool. Wayland global input is not supported.

## Changes

- Added the platform icon assets, Windows Win32 input backend, Linux X11 input backend, platform application launching and safer managed-process cleanup.
- Added Electron screen capture for supported graphical desktops, without bypassing operating-system consent or secure desktops.
- Bundled Cloudflare tunnel helpers pinned to release 2026.10.5 and verified by SHA-256 before packaging.
- Fixed Vortex's hard-coded-endpoint failure: API addresses are now configurable, a local gateway preset is available, DNS/proxy/auth/model errors are distinguished, and redirects cannot forward the saved key to another endpoint.
- Vortex Pro remains the default. A missing or unauthorized Pro model is reported rather than silently substituted.
- Kept Vortex keys in OS-backed encrypted storage; copied editor settings exclude the secret. Existing per-client permissions, Always Allow, approvals, emergency stop and OAuth pairing remain in place.

## Verification

44 automated tests passed on macOS. The signed packaged application opened all nine pages, displayed version 0.10.1, advertised 21 computer tools and reported no renderer errors. A saved Vortex key passed live model discovery and a real vortex-pro request in the packaged app. Production dependency presence and SHA-512 update-manifest hashes were checked for all three platforms. Windows PE resources were extracted to verify its icon, 0.10.1 version metadata, manifest and ASAR integrity resource.

Hosted Windows/Linux jobs did not start because the GitHub runner account was unavailable; their success is NOT claimed. The supplied workflow can run the native tests once runners are available.

## Limits

The Mac app is Developer ID signed but not Apple-notarized. The Windows installer is unsigned. Native Windows/Linux computer-control behavior still needs validation on those operating systems. Private updates require GitHub authorization. The existing VPS connection still uses a quick-tunnel address: Mac app restarts preserve it, but a VPS tunnel-service restart can rotate it.

The owner's Mac was configured to the reachable local Vortex gateway at http://127.0.0.1:18091/v1. Other computers need their own reachable Vortex endpoint; this release does not repair the external Vortex API DNS record or modify the Vortex server repository.
