# RedXDexAiBridge 0.10.9 — Background jobs and website crawling

## What runs while the desktop window is hidden

- The local MCP gateway and terminal processes remain available when **Keep running on close** is enabled.
- Jobs started through `process_start` continue without waiting for an interactive response, are isolated per paired client, and can be polled, sent input, or cancelled. Explicitly approved process timeouts support up to 24 hours; default timeouts remain shorter.
- Per-client limits, background-only desktop input restrictions, emergency STOP, folder approvals, and revocation continue to apply.
- On Windows, child command windows are hidden so running a job does not steal focus.

**Important:** A full application quit, operating-system logout, shutdown, sleep, or loss of required network connectivity can stop jobs. Unfinished jobs are **not automatically resumed after a restart**. Launch-at-login starts the gateway again; it does not replay prior commands or autonomously plan new work.

## Public website crawling

- New `crawl_start`, `crawl_list`, `crawl_status`, `crawl_results`, and `crawl_stop` MCP operations.
- A separate **Website crawling** capability uses default **Deny** and requires explicit per-client approval.
- Pages are collected asynchronously by the running Bridge. The desktop UI includes a URL field, crawl limits, progress, results, and stop controls.
- Boundaries: up to 20 pages, depth 0–3, one website per crawl, three concurrent jobs globally, two per client, 180-second per-job deadline, bounded page size, and a rate limit.
- Public HTTP/HTTPS only. Requests to internal addresses, loopback, private IP space, nonstandard ports, and cross-site redirects are blocked. DNS targets are checked and pinned before connecting.
- robots.txt is consulted and crawl-delay honored. Sites demanding a delay the crawler cannot safely honor are not crawled.
- Crawling collects public text and same-site links; it does not execute JavaScript, sign into websites, bypass access controls, or override robots policy.

## Verification

- Source-level and isolated runtime tests on Windows, macOS, and Linux through GitHub Actions, including bounded crawler, denial/abort, job ownership, and permission checks.
- Windows and Linux desktop smoke include a real process that finishes while the Electron window is hidden.
- Native macOS helper and source tests run on a hosted macOS runner. The owner's Mac was unavailable for live testing. There is no new signed/notarized 0.10.9 Mac installer.
- Native Windows installation, live public-site crawl, and release artifacts must be verified before declaring the release ready.

## Compatibility

Existing credentials, client registrations, folder approvals, terminal permissions, and Vortex configuration remain intact. New crawling permission is opt-in and does not change existing terminal permissions. No permission or operating-system security prompt is bypassed.
