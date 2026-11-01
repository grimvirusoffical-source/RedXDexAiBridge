# RedXDexAiBridge 0.10.12 — Reliable update checks during GitHub releases

## Updates

- When a new version tag appears before `latest.yml` or `latest-linux.yml` has been uploaded, **Check for updates** now reports a nonfatal `pending-release` state rather than showing a raw HTTP 404 or misleading GitHub token error.
- The message explains that release assets may still be publishing and directs users to retry once the public release is complete.
- The updater does not start a download or installation without the platform manifest.
- Prerelease updates are excluded by default.
- Unrelated failures such as certificate verification errors are still surfaced rather than silently classified as an incomplete release.
- Public Windows and Linux auto-updates do **not** need Git, GitHub CLI, Node.js or a personal access token.

## Security and compatibility

- Includes the 0.10.11 per-device client isolation and explicit per-client permission hardening.
- Existing OAuth pairings, file approvals, per-client policy settings, background jobs and user data remain unchanged by the installer.
- Windows x64 and Linux x64 packages are built and validated in GitHub Actions. macOS source and native checks run in CI; no new signed/notarized macOS installer is claimed.
- Each computer must still use its own device-specific authenticated MCP endpoint. The release does not introduce a hosted multi-tenant router.
