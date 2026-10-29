# Red-XAI Bridge 0.10.3 — Windows repair

## Fixed Windows behavior

- Mouse positioning uses physical screen pixels, with per-monitor DPI awareness in both native Windows input backends.
- Screenshot responses include the captured display, physical origin, PNG dimensions and an `imageToScreen` transform. Clients can map a resized capture back to actual pointer coordinates.
- The compiled helper reports input capability consistently and supports F1–F12. Optional keyboard modifiers may be omitted.
- The main window fits the available display work area. Navigation remains scrollable on small or highly scaled desktops.
- Screenshot smoke checks retry transient capture failures, record an explicit desktop fallback, and return a failing exit status on unhandled smoke-test errors.
- Windows packaging prepares the pinned, checksum-verified tunnel helper automatically. Generated native executables stay out of source control.
- Platform-neutral connection and permission wording replaces Mac-only wording in shared settings.

## Verification on Windows

The source passed JavaScript syntax checks and 55 automated tests, with no failures. One Linux-only symlink test was skipped on Windows because it requires OS symlink privileges; the Linux assertion remains enabled on Linux.

A disposable native test window passed eight checks: native status, DPI-aware movement/clicks, Unicode text, keyboard shortcut, key with omitted modifiers, actual scrolling, real PNG capture, and PNG-to-physical-pixel coordinate mapping. Input is sent only while that fixture has verified focus.

The observed Windows desktop was 2880 × 1800 physical pixels; the returned PNG was 1728 × 1080, with a 5/3 coordinate scale. Multiple-monitor and negative-origin mapping has unit-test coverage; physical multi-monitor behavior has not been exercised in this repair.

The packaged executable passed navigation checks for all nine pages, exposed 23 tools, loaded its preload bridge, and reported no renderer errors. The window fitted the 1440 × 852 logical-pixel work area. Direct window-image capture was unavailable on this remote display; the smoke report explicitly recorded its successful desktop-capture fallback.

The packaged native helper and packaged screenshot module separately passed all eight native checks. The installer completed successfully, and the installed executable reports 0.10.3.0. All 29 packaged application files matched the repaired source; all production dependencies were present, and the installed native helper matched the tested build.

The existing authenticated Shadow PC connection reconnected and reported version 0.10.3 with the same paired client and approved folders. Client capabilities remain set to Ask and background-only mode remains enabled. The owner must approve the requested capabilities locally and enable desktop tools before a full computer-control handoff; the upgrade does not grant those permissions.

## Permissions and delivery

This update preserves existing paired clients, approved folders and permission choices. An authenticated client still needs the owner's capability approval. Background-only mode still blocks direct mouse, keyboard and application-focus tools.

The Windows build is unsigned because no Windows signing certificate is configured. This repair does not change macOS signing or notarization.

Source updates and a locally built installer do not publish a GitHub release. Automatic update delivery requires separately published release assets and the private feed's configured GitHub access.
