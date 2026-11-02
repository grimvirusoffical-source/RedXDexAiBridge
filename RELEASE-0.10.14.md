# Red-XAI Bridge 0.10.14

- Status now reports effective per-client permissions, resolved modes, and legacy defaults separately. Explicit Always allow for crawling is correctly reported even when the legacy default is false. Existing enforcement and saved choices are preserved.
- The Permissions page shows the effective policy and accurately displays Ask for an unconfigured authenticated client.
- Added a detailed in-app Setup guide covering supported operating systems, local and remote MCP connections, OAuth approval, folders, permissions, crawling, background operation, diagnostics, and updates.
- Added an About page with Red-XAI LLC (Pending), the official website, repository, releases, and issue tracker. External links use a fixed main-process allowlist.

Validation: JavaScript syntax checks and all 11 focused crawling/permission tests passed in an isolated fixture. Full-suite, native UI, build, and installed-app verification remain pending; this source archive is not an installed release.
