# Red-XAI Bridge plugin setup 0.1.9

This public toolkit prepares a **private connection to your own computer**. It fixes a native Codex compatibility problem: unsupported server-level OpenAI extensions caused the portable MCP parser to omit the Bridge server. Generated configuration contains only the supported transport, endpoint and empty headers. OAuth discovery and owner approval remain required.

This toolkit is source and a command-line setup helper, not a public marketplace listing or a hosted multi-user computer gateway. No personal endpoint or credential is shipped. It does not update Bridge, sign in, change local permissions, or activate the shop.

## Prepare your own connection

1. Install and open Red-XAI Bridge on the computer you own or administer.
2. In Connections, start the HTTPS connection and wait for ONLINE. Copy its current plain HTTPS /mcp endpoint.
3. Use Node.js 20 or newer and run the following from the toolkit or repository root, replacing the example endpoint with your own verified URL:

    node scripts/export-chatgpt-plugin.cjs --endpoint https://YOUR-VERIFIED-HOST/mcp --output ./my-private-bridge

The helper verifies the path-specific OAuth protected-resource document, its exact resource URL and HTTPS authorization server before creating any files. An offline or mismatched endpoint produces no output package. The output directory must be new; existing files are never overwritten.

For a **new** private plugin, use the generated package with your client's supported local/private plugin installation workflow. When an archive is required, ZIP the generated directory's contents, including the dot files and .codex-plugin directory. Keep that archive private. Complete your client's normal OAuth flow and approve pairing on your Bridge computer. Verify actual bridge_status and get_profile results before computer work.

For an **existing** private plugin, avoid duplicates and preserve its manifest, identity, presentation, skills and permissions. Generate only the two connection files:

    node scripts/export-chatgpt-plugin.cjs --endpoint https://YOUR-VERIFIED-HOST/mcp --output ./my-private-bridge-config --config-only --server-name EXISTING_SERVER_NAME

Use config-only mode for a standard OAuth Bridge entry with empty headers. Preserve any additional connection options through their owning workflow. Read the existing MCP configuration and supply its exact server key as EXISTING_SERVER_NAME. Merge only that generated server entry into the original mcp.json and .mcp.json using the supported existing-plugin update workflow, preserving every other server declaration. Do not upload these replacement maps over a multi-server configuration. If that workflow does not support partial updates, retrieve the existing source and replace only those connection declarations before repackaging. Do not replace an App-managed binding with a file declaration. Never copy another person's OAuth tokens, credentials or endpoint.

Temporary tunnel URLs may change after a restart. Repeat the existing-plugin connection update using your computer's newly verified URL; do not publish that endpoint as a universal connection for everyone.

## Verify and troubleshoot

- Native Codex recognizes the portable streamable-http entry and uses OAuth discovery by default. Do not add an auth:none fallback or bearer-token header.
- Configuration discovery and public tools/list are not sign-in tests. Confirm authenticated profile/status results and local permissions.
- If the server declaration appears but authentication is required, use that client's supported OAuth sign-in flow. Do not reuse another connection's grant.
- Respect background-only mode. Release your own desktop-control lease when GUI work ends.
- The toolkit supports Windows, macOS and Linux with Node.js 20+. Tests on one computer do not prove another OS or device passed acceptance.

## Public listing status

A public GitHub download is not an approved ChatGPT marketplace listing. Directory submission still needs a verified publisher, all required published listing/policy URLs, actual demo/review evidence, intended country targeting and authorized developer attestations. This toolkit does not invent those materials or expose an owner's desktop to reviewers.

## Build a release toolkit

From a repository checkout, maintainers on Windows can create the sanitized source/setup ZIP using the allowlisted builder, without bundling any generated private connection:

    .\scripts\package-chatgpt-plugin-toolkit.ps1 -OutputFile C:\path\to\new-toolkit.zip

PROVENANCE.json records the source commit, source-tree state and file hashes. Build release artifacts from a clean committed checkout. Publish a toolkit release with make_latest:false and verify that the stable desktop updater still selects the desktop release. Do not replace desktop updater metadata with toolkit assets.
