# RedXDexAiBridge 0.10.11 — Per-device connection boundaries

## Every computer has its own Bridge identity

- Each Windows, macOS or Linux installation runs its own loopback MCP server, its own client registry, device profile, OAuth approval queue and permission settings.
- A temporary HTTPS tunnel belongs to only that installed device. Its URL must not be copied into a globally shared plugin for unrelated people.
- No multi-user cloud proxy is deployed in this release. A future shared directory would require separate user sign-in, device enrollment and owner-bound routing before any control is exposed.

## Authorization hardening

- When a paired MCP client has no policy for a capability, it can no longer silently inherit a global Always Allow permission. If the global capability is enabled, an explicit local approval is required; otherwise it is denied.
- Existing per-client Deny, Ask and Always Allow choices are preserved. A local legacy stdio session retains its pre-existing behavior.
- A regression test launches two distinct MCP servers with identically named client IDs, then verifies that one server's tokens never authenticate on the other. Revocation on one device does not revoke or authenticate on the other.
- New permission regression tests verify that a one-time approval does not persist as Always Allow and that Deny still wins.
- Tests refuse to execute against a real user's Bridge data folder.

## Connection setup

- The Bridge Connections page now clearly explains that a remote MCP URL belongs to **this computer**, and that each user must create their own private connection.
- The README documents how to pair through OAuth, the limits of short-lived Cloudflare tunnel URLs, and the need for a user-controlled stable relay for persistent endpoints.

## Platforms and remaining limits

- Windows and Linux installation packages are published by the cross-platform CI release pipeline after native and regression tests pass.
- macOS source/native tests run in CI; this pipeline does not provide a newly signed and notarized macOS installer.
- Remote OAuth pairing and operating-system permissions always require the actual computer owner's consent.
- The Bridge does not grant cross-device access or provide a universal hosted multi-tenant MCP router; connected ChatGPT plugins still need a device-specific authorized endpoint.
- Existing saved client registrations and user preferences are not reset by this update.
