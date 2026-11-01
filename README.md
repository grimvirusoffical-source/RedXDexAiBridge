# Red-XAI Bridge

## Version 0.10.9: background jobs and crawling

**Background execution:** A running Bridge can finish approved terminal jobs when its window is hidden. Use `process_start` to launch a process and `process_list` / `process_output` / `process_stop` to monitor it. Background-only mode blocks direct mouse, keyboard, and application-focus tools, but permits approved non-focus work. Explicit process timeouts can extend to 24 hours.

**Public website crawling:** The Files & terminal page provides a crawler with progress and stop controls. MCP clients use `crawl_start`, `crawl_status`, `crawl_results`, `crawl_list`, and `crawl_stop`. A separate crawl permission defaults to **Deny**. Jobs remain owned by the pairing that started them. Each crawl is bounded to one public site, up to 20 pages and depth three, honors robots.txt and supported crawl-delay directives, and rejects private-network addresses and cross-site redirects.

**Background limitations:** Jobs continue while the app is running, including when hidden. Fully quitting the application, logging out, shutting down, or suspending the computer can interrupt them. Work does not automatically resume after a reboot, and the Bridge does not independently invent new tasks. See [0.10.9 release notes](RELEASE-0.10.9.md).


A permission-controlled desktop gateway for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) clients. Connect local and remote development tools to Windows, macOS, or Linux while retaining control over permitted operations, approved folders, and individual client access.

## Downloads

The [Releases page](https://github.com/grimvirusoffical-source/RedXDexAiBridge/releases) contains platform-specific packages and checksums.

| Platform | Package | Status |
| --- | --- | --- |
| Windows x64 | One-click, per-user `.exe` installer | Version 0.10.8 published; executable is currently unsigned |
| Linux x64 | AppImage and Debian `.deb` | Version 0.10.8 published |
| macOS Apple Silicon | Earlier Developer ID–signed DMG | Version 0.10.8 source checks passed; no new signed or notarized Mac installer was published |

Windows may show a SmartScreen warning until a verified code-signing certificate is configured. Never treat a successful build as proof of signing or notarization.

## Getting started

1. Install the package for your operating system and open the desktop application.
2. Use the **Overview** page to start the local gateway and check desktop permissions. In the installed application, the setup action can also enable launch at sign-in.
3. Open **Connections**, select your preferred client, and use the add action. Supported local integrations include Codex CLI, Claude Desktop, VS Code, Cursor, and Gemini CLI.
4. Approve only the folders and capabilities that client needs. Each newly paired client starts with **Ask** permissions.
5. For remote connections, start the HTTPS relay, verify that its endpoint is online, and complete the explicit OAuth pairing approval.

Other MCP-compatible local applications may use a loopback-only HTTP endpoint and a separately revocable bearer credential. Each credential is shown only at creation. Treat it like a password and never paste it into a public issue.

The application backs up supported existing client configurations before modification and refuses to replace unmanaged entries without an explicit supported workflow. Reload or restart the client after connecting.

## Connectivity

The local MCP gateway binds to the loopback interface and requires a paired credential for computer operations. The remote endpoint is separate from the local gateway and must be verified before connecting. A temporary Cloudflare relay address can change after a restart; a stable, separately operated HTTPS relay is needed for a permanent endpoint.

A healthy gateway does not establish that an external integration has completed its own connection or authorization. If a remote integration cannot connect, check the endpoint, its authentication configuration, and the local approval queue independently.

## Permissions and safety

Clients have individual **Deny**, **Ask**, and **Always Allow** choices for file listing, file access, terminal operations, screen capture, pointer control, keyboard input, and application launches. Background-only mode prevents direct focus and input operations. Revocation disables a client credential, and the **STOP COMPUTER CONTROL** action blocks new computer operations and stops managed terminal sessions.

Terminal access is powerful and **is not an operating-system sandbox**. An approved working directory does not prevent a command from accessing other resources available to that operating-system user. Use a separate account or virtual machine for stronger isolation.

The application cannot bypass Windows UAC or protected desktops, macOS privacy prompts, or Linux display-server restrictions.

## Platform requirements

- **Windows:** interactive signed-in desktop; native Win32 input helper. Locked, protected, or higher-integrity desktops remain inaccessible.
- **macOS:** Accessibility and Screen Recording consent for the application; native Swift helper. Developer ID signing and Apple notarization are separate release requirements.
- **Linux:** X11 and `xdotool` for global mouse and keyboard control. Wayland portal capture may be available, but global input injection is not implemented.

## Vortex integration

Enter a supported Vortex API endpoint and credentials through the application's settings. Credentials are encrypted using the operating system's secure storage, where available; the application does not fall back to plaintext storage on Linux. A local gateway preset is provided for an existing service running at `http://127.0.0.1:18091/v1`.

Network failures, authentication failures, and unavailable models are surfaced explicitly. A requested model or endpoint is not silently replaced with another one.

## Building and testing

Use Node.js 24 with the repository's pinned dependencies:

```sh
npm ci
npm run check
npm run prepare:native
npm run prepare:tunnel
```

Build on the target operating system with `npm run package:win`, `npm run package:linux`, or `npm run package:mac`. Build output goes to `dist/`. Windows/Linux GitHub Actions verify unit tests, native helpers, desktop smoke checks, installers, and artifact hashes; macOS Actions check source and native helper compilation. Consult the release notes for limitations specific to each version.

For defects, include the operating system, application version, the relevant operation, and a **redacted** error message. Do not upload credential stores, access tokens, raw environment files, or private screen captures.

## License and third-party notices

The repository's package metadata currently declares `UNLICENSED`. Public access to its source does not itself grant redistribution or modification rights. See [Third-party notices](THIRD_PARTY_NOTICES.md) for dependencies and their licensing information.
