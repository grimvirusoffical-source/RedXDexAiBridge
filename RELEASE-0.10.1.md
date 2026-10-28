# Red-XAI Bridge 0.10.1

Cross-platform release candidate. Publication is gated on the native-platform build results.

- New red-X application icon for macOS, Windows and Linux.
- Windows native input helper and Linux X11 mouse/keyboard support.
- Electron screen capture, platform application launching, and managed process cleanup.
- Configurable Vortex API base address, a local-gateway preset, Pro default, OS-encrypted keys, and error messages that distinguish DNS/proxy failures from rejected keys. No silent endpoint or model fallback.
- Bundled checksum-verified tunnel helper and platform release/update packages.
- Existing OAuth, Always Allow/Ask/Deny, emergency stop, and approved-folder protections are retained.

Limits: Linux global input requires X11 and xdotool; Wayland global input is not implemented. Mac privacy permissions and Windows secure-desktop boundaries remain enforced. This Mac build is Developer ID signed, not notarized; Windows signing is not configured. The existing VPS relay remains a quick tunnel, not a permanent custom domain.
