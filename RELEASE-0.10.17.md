# Red-XAI Bridge 0.10.17

This release updates the Windows installer and the CLI download buttons.

- The Windows installer uses a red and black theme, a transparent X icon, and a circular progress display with a live 0/100 counter and installation status.
- CLI buttons on sign-in and settings download the public CLI archive into a folder you choose, verify its size and SHA-256 checksum, and report the saved file. The CLI requires Node.js 20 or later and is not executed automatically.
- Installer verification checks the installed application, native helper, sign-in interactions, and the theme against native installation progress on an isolated Windows runner.

The existing account sign-in flow, paired client credentials, saved settings, and production authentication release checks are retained. This release contains only installer and CLI download fixes.
