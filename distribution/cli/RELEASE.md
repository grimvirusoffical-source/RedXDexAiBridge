# Red-XAI CLI 0.3.0

Public distribution of the tested Red-XAI CLI package. The source repository remains private; this release contains the distributable package and its checksum only. Requires Node.js 20 or newer.

- `REDXAI bridge download`: download the correct verified stable Bridge package for this operating system.
- `REDXAI bridge install`: install that package with platform and checksum checks. Current unsigned Windows installers require the explicit `--allow-unsigned` option. No unsigned macOS substitution is made.
- `REDXAI update`: update the CLI from verified public CLI release assets; `--download-only` downloads without installing.

Install the downloaded archive with `npm install -g ./redxai-cli-0.3.0.tgz`, then run `REDXAI --help`. Commands do not expose private repository credentials. This CLI release does not replace the latest stable desktop Bridge release.
