# Red-XAI Bridge v0.10.15 — development candidate (not published)

This source branch stages the next authentication integration and numeric application registry design. It is NOT an installable release and has not been merged, tagged, built, or deployed.

- Added an isolated Red-XAI account-authentication module that supports Quick Login PKCE browser approval and a separate manual website email/username + password and conditional 2FA flow.
- Added tests that verify Bridge client scope isolation, server-verified account identity, account-switch isolation and numeric application ID 6.
- Added a dry-run-by-default RedX app registry/usage metadata provisioning utility. No live database table has been modified; the RedX and Accounts service repositories are unchanged.
- Documented production authentication gate requirements and the CLI publishing prerequisite in REDXAI-ACCOUNT-INTEGRATION.md.
- Carried forward v0.10.14 permission and settings/source work from the feature branch.

Required before publishing a functional 0.10.15 installer: merge and deploy Bridge Quick Login client registration; implement and test app-startup/UI and all MCP privilege gates; implement trusted server-side per-account app usage tracking; verify actual CLI installer distribution; pass platform GUI, release packaging and automatic-updater artifact checks. The current source is not an installed or deployed login-required app.

Do not issue tag v0.10.15 or attach installer assets until these gates pass.
