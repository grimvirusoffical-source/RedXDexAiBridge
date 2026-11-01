# RedXDexAiBridge 0.10.10 — Optional desktop shortcut and taskbar pin guidance

## Windows setup

- Fresh interactive Windows installations offer an explicit **Create desktop shortcut** choice. Choosing No removes only the Bridge desktop shortcut; the desktop application and Start menu entry remain installed.
- Fresh interactive installations also offer **Help pinning to taskbar**. Choosing Yes records an opt-in for a lightweight first-launch panel in the desktop application.
- Windows requires users to approve taskbar pinning from a foreground application. The installer does not manipulate taskbar layout, automate a context menu, or bypass Windows policy. The panel describes how to right-click the running app icon and select **Pin to taskbar**, and offers Microsoft's official instructions.
- Silent updates and in-place upgrades skip these initial installer prompts; existing shortcuts and user preferences remain untouched.
- The existing optional Node.js LTS, Git and GitHub CLI installer choices remain independent and fully optional. Public updates require none of these packages.

## Platform status

- Windows x64: NSIS one-click per-user installer with configurable desktop shortcut behavior and first-launch taskbar guidance.
- Linux x64: AppImage and Debian packages continue to be built with native CI tests. Windows taskbar pinning is not applicable to Linux.
- macOS: native Swift helper and source tests run on macOS CI. No new signed and notarized macOS installer is distributed by this release pipeline.
- No operating-system permissions, elevated desktops or secure prompts are bypassed.

## Validation

- Windows source tests cover the installer prompt, default shortcut settings, user-data marker, symlink handling and in-app controls.
- Windows installer compile and artifact checksum validation are release gates.
- GitHub Actions Windows, Linux, macOS native checks must pass before tag publication.

## Uninstallation and retained data

The installed application may be uninstalled without removing the separately saved Bridge client registry, folder approvals, encrypted secrets and remote pairing records. User-controlled connection settings are retained for a later reinstall unless separately deleted.
