# Red-XAI Bridge 0.11.0 — platform preview

This candidate adds the red/black Windows installer with a native-progress X ring, a verified direct CLI download, independent terminal/crawler client credentials, plugin recipes, a six-tier membership catalog, Axioms, account controls, and owner/admin pages.

Platform commerce is NOT enabled in the stable app. The production account-authority adapter, protected RedX credentials, verified owner subject/MFA linkage, published agreements, Stripe server credential and signed webhook deployment must pass integration readiness first. Sandbox catalog creation and isolated fixtures are not evidence of a production deployment. Stable remains v0.10.19, including its verified manual-login correction. This preview includes that correction without further sign-in changes.

Owner benefits are server-authoritative: all plugins and the highest tier free forever on unlimited enrolled devices, while normal authentication, device proof, tool permissions and emergency STOP remain required. Admins do not inherit owner benefits.

This candidate implements Bridge-specific weekly active-work and crawler allowances. Global subscription projection across other Red-XAI apps has not been verified or deployed. Idle/approval waits do not count. Ruby has unlimited active-work time; safety and network limits still apply. Axioms use integer hundredths ($1 = 1 AX; minimum top-up $5.01). Workflow Checkpoints is proposed at $3.99 once per enrolled device, with three verified recoveries per rolling year for purchased licenses.

No uploaded arbitrary plugin code executes. Published plugin recipes use existing approved tools. Workspace Snapshot, Cleanup Preview and Crawl Brief are free. Workflow Checkpoints stores file snapshots in encrypted local storage and asks before restoring files or running a user-specified build command.

Validation completed for this candidate:

- Windows `npm.cmd run check`: 533 tests, 529 passed, four expected skips, no failures.
- Hosted Windows and Linux CI passed, including application/package sign-in, platform pages, the Windows installed-app/native-helper checks, and the installer theme check. macOS source/helper smoke checks passed; macOS distribution remains deferred.
- Genuine isolated Stripe Sandbox Checkout passed for a $7.99 Gold subscription, a $3.99 device plugin, and a $5.23 Axiom top-up. Signed provider webhooks granted the corresponding entitlement or balance. Gold test-clock renewal, refunds, entitlement revocation, and provider subscription cancellation were verified. The plugin refund revoked its license, and the Axiom refund returned the balance to zero.
- These payment tests used fixture identities and a development FileStore. They do not establish production account/MFA integration, native RedX deployment, live-payment readiness, or global subscription projection. The fixture customers/clock and temporary webhook endpoints were deleted. The temporary Sandbox credential was revoked and verified invalid, its protected local copies were removed, and the test tunnel was stopped.

Production readiness remains required before stable promotion. This candidate is intentionally a preview, not a claim that live billing, global moderation or deletion have been deployed. The working stable installation is unchanged.
