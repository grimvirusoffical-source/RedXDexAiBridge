# Red-XAI Bridge v0.10.16

Fixes the unresponsive Quick Login and manual sign-in buttons in v0.10.15. The sign-in script now runs in a private scope so its local `bridge` binding cannot conflict with Electron's protected `window.bridge` API. Both login paths can initialize normally.

The regression check loads the real sign-in page and preload, clicks Quick Login, submits a test-only manual login against isolated IPC fixtures, and requires the second-factor screen to appear with no renderer errors. It runs on Windows, Linux and macOS before release packaging.

Production Quick Login supports Bridge (`bridge.app`), Vortex and GenDragoon. Real-account Bridge authorization, scope isolation, refresh rotation, replay refusal and revocation were verified during the production deployment.

Existing settings, device ownership, MCP OAuth registrations, per-tool approvals, MFA and account authentication requirements are preserved. This update does not reset an enrolled device or grant computer access without authentication and client approval.

Windows and Linux installers are included. Windows installers remain unsigned; no signed/notarized macOS installer is included. Named Cloudflare tunnels still require owner-provided configuration. Optional CLI distribution and central app-usage provisioning are separate from this login repair.
