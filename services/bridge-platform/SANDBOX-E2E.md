# Real Sandbox payment verification

`sandbox-e2e.cjs` is an operator-run test against the existing **Red-XAI LLC sandbox**, account `acct_1USFfGEKYCPRlM5G`. It never uses live-mode credentials. Its dedicated customer, enrolled device, signing key, legal fixtures and development-only file ledger are isolated from Red-XAI users and production account data.

This is payment integration evidence. It does **not** verify production account authentication/MFA, legal approval, RedX storage, the public proxy or a production webhook endpoint. Every status result reports `fixtureIdentity: true` and `productionReady: false`.

## What each run does

Choose one scenario and a fresh private run directory:

| Scenario | Human Checkout | Automatic follow-up after its genuine signed delivery |
| --- | --- | --- |
| `subscription` | Gold, $7.99 in test money | Verify Gold grant; advance a dedicated provider test clock across the first renewal; verify a real renewal invoice receipt; refund that renewal; verify entitlement removal and actual provider cancellation. |
| `plugin` | Workflow Checkpoints, $3.99 in test money | Verify the signed device license; refund the payment; verify license removal. |
| `credits` | 5.23 AX, $5.23 in test money | Verify 523 integer credit hundredths; refund the wholly unused payment; verify zero balance and zero debt. |

Run all three to exercise the three purchase paths. Each run requires one genuine human-completed hosted Checkout. The driver never changes `payment_status`, generates a fulfillment event, calls the adapter's internal `event()` method, or manufactures a webhook signature. Fulfillment runs through the existing raw-body SDK signature verifier and retrieves current provider objects.

The subscription test advances Stripe's test clock, not the computer's clock or production application time. It validates payment lifecycle processing rather than quota expiry or real-world retention behavior. Renewal requires the newly paid receipt's exact period to match both the current provider subscription and the local membership's `untilMs`, plus a signed delivery after renewal started. A still-active initial Gold period is insufficient. Refund completion separately requires the current provider refund to have succeeded, entitlement removal and actual provider cancellation; a Free result is a revocation check, not a claim that the computer's clock advanced or an old period naturally expired.

## Checkout and clock compatibility

The driver creates a normal customer **without a clock** for hosted Checkout. Only after a genuine paid Checkout grant does it create a clock attached to that existing fixture customer. This uses the documented `customer` parameter introduced in [Stripe API 2026-05-27.dahlia](https://docs.stripe.com/changelog/dahlia/2026-05-27/test-clock-creation-customer-parameter), which is present in the repository's pinned Stripe SDK 23.1.0 and its 2026-10-28.endive API contract. The reviewed official material does not affirm hosted Checkout compatibility for a customer already on a clock, so this driver does not depend on that combination.

The [current clock limits](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage) apply to attaching an existing customer: its initial frozen time cannot be in the past, provider object-count limits still apply, and existing account-wide Billing Automations can prevent attachment. The driver saves one stable initial time slightly ahead of wall time before the idempotent create request. It never removes Automations or changes account-wide settings to make a test pass. If the provider rejects this setup, stop and review the fixture environment.

The fixture uses one customer and one subscription. It advances only across the next monthly boundary (plus one hour), within the documented [maximum of two subscription intervals per advance](https://docs.stripe.com/billing/testing). Choose a published test **card** in hosted Checkout: clock advancement does not support collecting bank-debit payments during the simulation. Attaching a customer to a clock is irreversible; deleting the clock also deletes the customer and subscriptions. A clock that is shared, renamed, foreign or otherwise unconfirmed is refused by cleanup.

## Protected credentials and minimum permissions

Use a dedicated **Sandbox restricted API key** (`rk_test_`), stored through the protected-secret intake workflow. Do not put a key in this repository, config JSON, a command argument, a Checkout URL, a ticket or chat. The driver imports `readSandboxKey` and `readWebhookSecret` from `protected-secret.cjs`; both are passed the pinned account ID. The Windows intake must use CurrentUser DPAPI and restrictive ACLs. Server plaintext secret files must be private regular files, mode 0600, in a protected directory.

On Windows, the intake commands below are available **only where the existing execution policy permits the script**. On this Shadow PC, effective Windows PowerShell policy is `Restricted`, and the `.ps1` intake was correctly refused without creating a credential file. Do not change/bypass execution policy or run the refused script through an alternate loader. Real provisioning here needs existing protected server secret storage, an approved signed-script delivery where the policy permits it, or a normal policy-approved environment. The reader's non-provider DPAPI round trip passed separately; that does not prove the blocked intake success/ACL path ran. Hosted CI may test that success path only if its normal policy permits it.

A separate approved native private intake has since saved a CurrentUser-DPAPI Sandbox restricted-key envelope outside Git. The blocked `.ps1` was not used. The root-owned SDK preflight confirmed account `acct_1USFfGEKYCPRlM5G`, `livemode: false` and all eight catalog prices. This is read-only credential/catalog evidence, not signed webhook, Checkout or E2E evidence. That approved billing key currently excludes Events Read and broad CLI capabilities; do not start a CLI listener under it until that additional access is reviewed.

In a policy-approved environment, use a private interactive PowerShell session. Replace only the example destination paths with new private absolute paths outside any Git checkout. The script prompts for hidden input, writes a DPAPI envelope and preserves an existing destination:

```powershell
& .\scripts\save-bridge-sandbox-secret.ps1 -Kind sandbox-api -Path 'C:/private/redx-bridge-sandbox/api-key.json' -Account 'acct_1USFfGEKYCPRlM5G'
& .\scripts\save-bridge-sandbox-secret.ps1 -Kind sandbox-webhook -Path 'C:/private/redx-bridge-sandbox/webhook-secret.json' -Account 'acct_1USFfGEKYCPRlM5G'
```

Windows PowerShell 5.1 and PowerShell 7 use different module paths, and inherited `PSModulePath` can alter module discovery. The intake/reader explicitly import the native `Microsoft.PowerShell.Security` manifest under the executing engine's `$PSHOME`; they do not change the environment's module search path. See Microsoft's [about_PSModulePath](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath). The optional PowerShell intake creates its file with the private ACL already attached: [FileSystemAclExtensions.Create](https://learn.microsoft.com/en-us/dotnet/api/system.io.filesystemaclextensions.create) on modern .NET, or the security-aware [FileStream constructor](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.-ctor?view=netframework-4.8.1) on .NET Framework. This avoids changing an ACL through a write-only stream. Its positive path still needs a normally permitted script environment; API compatibility does not override execution policy.

Give the restricted key the resource access needed by these requests. In the Dashboard, Write includes the corresponding reads; some newer resource permissions can be grouped under a parent resource:

| Access | Requests made |
| --- | --- |
| Account details: Read | Retrieve the current authenticated account and require its exact Sandbox ID. |
| Prices and Products: Read | Validate all eight pinned catalog prices and expanded products. |
| Billing Portal configurations: Read | Revalidate the existing restricted cancellation/payment-method configuration before subscription Checkout. |
| Customers: Write | Create/retrieve only the fixture customer, list customers on its dedicated clock, and delete that exact customer during cleanup. |
| Checkout Sessions: Write | Create/retrieve the fixture Checkout; expire its still-open session during cleanup. |
| Subscriptions: Write | List/retrieve the fixture customer's subscriptions; cancel the paid subscription after its verified full renewal refund. |
| PaymentIntents and Charges: Read | Retrieve the current payment and expanded latest charge to bind actual refund state. |
| Invoices and InvoicePayments: Read | Validate actual renewal line items, paid allocations and immutable receipt bindings. |
| Refunds: Write | Refund only the exact payment intent stored for this run. |
| Test clocks: Write | Create/retrieve/advance/delete only the clock created for the subscription fixture. |

The harness does not need payout, transfer, bank-account, Connect-account modification, API-key management, or live-mode permissions. A production billing key additionally needs the separately reviewed permissions for all supported production webhook types; this list concerns this isolated test only. If a restricted resource denies preflight, adjust that specific Sandbox permission in the Dashboard; do not replace the key with a live or unrestricted key.

Install the repository's pinned SDK, without changing its version:

```sh
npm ci --prefix services/bridge-platform --ignore-scripts --no-audit --no-fund
```

## Genuine signed webhook channel

The listener binds **127.0.0.1 only** and accepts only `POST /redxai-bridge/api/stripe/webhook`, with a loopback Host header. It exposes no fixture identity, account mutation, status or billing-control HTTP API.

Use an authenticated Stripe CLI listener for the same Sandbox, forwarding **classic v1 snapshot events** with `--forward-to` to:

```text
http://127.0.0.1:17784/redxai-bridge/api/stripe/webhook
```

Forward these types: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`. The existing handler does not consume thin-event payloads. Do not configure `--forward-thin-to` for it.

Use `stripe whoami --format json` only as a CLI profile diagnostic, never a configuration dump. With an environment-key override, its account ID can be absent or reflect cached profile metadata. Prove the actual key's identity through SDK `accounts.retrieve()` and require the exact Sandbox account before opening a listener session. Keep the signing secret private and pass it directly to protected webhook-secret storage. Never send it to chat or capture secret-bearing startup output in public logs. Do not run `stripe sandbox create`: keep the existing Sandbox and pinned catalog.

With CLI forwarding, omit `webhookEndpointId`: the CLI listener is not a Dashboard webhook endpoint. A direct public event destination requires a separately provisioned, reviewed HTTPS route, matching signing secret/API version and the exact event set; do not point a destination at this private address. No destination is automatically created or changed by this harness. Local forwarding does not establish production endpoint readiness.

Fresh read-only provider inspection on 2026-11-02 found no configured Sandbox webhook endpoints. Provisioning an actual delivery channel is still required; the current catalog/portal verification is not webhook or payment fulfillment evidence.

## Reviewed CLI delivery design

This source-only design does not install/start the CLI or read credentials. The reviewed official version is [v1.55.6](https://github.com/stripe/stripe-cli/releases/tag/v1.55.6), source commit `3292c3301c85bcf9ab034e6e6146dbcf67c27416`.

The source [accepts restricted API keys](https://github.com/stripe/stripe-cli/blob/v1.55.6/pkg/validators/validate.go#L87) and supports [`STRIPE_API_KEY` as an override](https://github.com/stripe/stripe-cli/blob/v1.55.6/pkg/config/profile.go#L445). The key can therefore stay in the child process environment, with no `--api-key` argument, plaintext config or console output. [`listen --print-secret` prints and exits](https://github.com/stripe/stripe-cli/blob/v1.55.6/pkg/cmd/listen.go#L214); it does not keep forwarding. Capture the secret from the actual long-running process's [Ready status](https://github.com/stripe/stripe-cli/blob/v1.55.6/pkg/cmd/listen.go#L331), not a different session.

### Verify the executable first

The official release metadata reviewed for Windows x64 gives:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `stripe_1.55.6_windows_x86_64.zip` | 11,560,247 | `d307b986e14f9bafd696d889f80191def044678e44174d7c5b742e7c7b3c9ba7` |
| `stripe-windows-checksums.txt` | 196 | `259c9f284925842bcf18616ea2ba55a0e869c8ecc8e0a9a5b35b35fedc38b56e` |

Download both from that exact official release. Check byte sizes/digests and the checksum text's exact archive-name entry before extraction/execution. A mismatch needs fresh review. Validate archive paths against a dedicated tools directory and invoke the verified executable by absolute path. This is published artifact-integrity verification, not a claim that Authenticode was inspected. The [official Windows release configuration](https://github.com/stripe/stripe-cli/blob/v1.55.6/.goreleaser/windows.yml) generates the checksum text.

### Supervisor sequence after scope review

1. Decrypt the approved `rk_test_` using the protected reader, and verify the actual SDK account matches the Sandbox. Isolate a fresh private CLI config and unique nonsecret profile to avoid existing OAuth/keyring/profile state. Do not edit the normal Stripe config.
2. Create a child-only environment: remove inherited `STRIPE_*` values and set only the approved `STRIPE_API_KEY` plus nonsecret `STRIPE_DEVICE_NAME`. Do not change the parent environment, dump spawn options or persist the key.
3. Spawn the verified executable with `shell: false`, `windowsHide: true`, stdin ignored, and both stdout/stderr privately piped. Use nonsecret arguments: `--config <private config> --project-name <unique profile> --device-name redx-bridge-sandbox-e2e --color off --log-level info listen --skip-update --events-from @self --events <snapshot-event CSV above> --forward-to http://127.0.0.1:17784/redxai-bridge/api/stripe/webhook`. Do not enable live/thin/JSON-event output, debug/trace, custom API hosts, TLS skips or unencrypted WebSockets.
4. Parse the actual Ready line in bounded memory and pass its one `whsec_` directly to the root-owned approved native protected writer, bound to this Sandbox and kind `sandbox-webhook`. Discard other raw output instead of logging it. Store only CurrentUser-DPAPI/private-ACL ciphertext on Windows, or private mode-0600 server storage; do not invoke the blocked intake file through another loader.
5. Start the harness only after the protected signing secret is durably stored and the listener remains alive. Emit only fixed sanitized readiness/error messages and nonsecret counts. For CLI forwarding omit `webhookEndpointId`. If reconnection changes the signing secret, stop further driver actions and mark the run pending; never continue against a stale verifier or manufacture missing delivery evidence.
6. Keep the listener alive through genuine Checkout and follow-up assertions. On completion, timeout or stop, terminate only this supervisor's own listener/driver children. Retain sanitized pending evidence; do not kill unrelated Stripe, Node or Bridge processes.

**Permission blocker:** restricted-key parsing/environment support is confirmed, but authorization for the saved billing key to consume account events/create a CLI session is not. The public CLI source does not establish an exact Dashboard RAK permission combination that makes its session handshake succeed. Its listener calls its own session-authorization API; let the CLI make that handshake only after approval rather than calling internal endpoints directly. The current key explicitly excludes Events Read/CLI-wide access, so SDK preflight success is insufficient permission to start it. Review the narrow additional Sandbox capability or use an approved normal Sandbox CLI login/registered HTTPS Sandbox event destination. Never substitute an unrestricted/live key or weaken mode/account checks. Stripe's [restricted-key guide](https://docs.stripe.com/keys/restricted-api-keys#assign-permissions) recommends inspecting failed request logs to identify a missing permission; do not infer that Events Read alone is sufficient for CLI authorization.

## Private configuration

Save a private JSON file outside Git, replacing paths with protected absolute paths. For Windows JSON paths use forward slashes or escaped backslashes. Protect the run directory with the same user's ACLs because it contains fixture signing material and the ledger. On POSIX use directory mode 0700 and file mode 0600.

```json
{
  "account": "acct_1USFfGEKYCPRlM5G",
  "mode": "sandbox",
  "scenario": "subscription",
  "apiKeyFile": "/absolute/protected/sandbox-api-key",
  "webhookSecretFile": "/absolute/protected/sandbox-webhook-secret",
  "runDirectory": "/absolute/protected/bridge-e2e-subscription-01",
  "allowSandboxMutations": true,
  "port": 17784,
  "waitSeconds": 1800
}
```

An actual direct endpoint ID can be supplied as `webhookEndpointId` only when the configured secret/delivery channel belongs to that endpoint. CLI forwarding omits it. The explicit mutation flag authorizes only Sandbox test fixture writes; `preflight` and `status` remain read-only.

```sh
node services/bridge-platform/sandbox-e2e.cjs preflight /absolute/protected/config.json
node services/bridge-platform/sandbox-e2e.cjs run /absolute/protected/config.json
```

The run prints a Sandbox-only Checkout URL and a pending stage. The URL must use the exact saved `cs_test_` session ID under `https://checkout.stripe.com/c/pay/`; a `cs_live_` ID, different saved session, credential-bearing URL, unexpected port/query or changed path is rejected. A person should open that URL and pay using Stripe's published test card details. Never bypass a Checkout security challenge. Stripe's official automated-testing guidance says its frontend interfaces include measures that prevent automated UI testing; mocked CI remains separate from this occasional real-provider test.

After successful Checkout, keep the process and signed delivery channel running. A `complete` result requires real signed fulfillment, and the scenario's real refund/renewal/cancellation assertions. A timeout exits with code 2 and a pending stage; it is not success. Errors are sanitized and do not echo raw SDK errors, credentials or provider responses.

## Resume, inspect and clean up

Resume a timed-out run with the same `run` command and configuration. Its exact provider objects and idempotency keys are reused. Private config and run paths must be canonical paths outside Git and without any symlink, junction or other reparse ancestor. Windows path guards inspect filesystem attributes with a read-only .NET call; they do not load or execute the blocked intake script. Only one process can write a run directory; `run.lock` prevents a concurrent driver. A crash can leave that lock. Confirm the original driver has stopped before removing only that run's lock file. Do not start concurrent writers or clear a live lock.

```sh
node services/bridge-platform/sandbox-e2e.cjs status /absolute/protected/config.json
node services/bridge-platform/sandbox-e2e.cjs cleanup /absolute/protected/config.json
```

Status reads the existing private manifest without loading credentials or calling Stripe. Review the private `run-state.json` and `fixture-ledger.json` as needed without publishing secret files or raw personal/provider payloads. If a pending Checkout has expired, retain that run's record and clean up; start a fresh isolated run rather than altering an old order into a paid one.

Cleanup rechecks the Sandbox account, exact customer ID, fixture metadata, subject and clock binding. A test clock is deleted only when its name matches this run and its customer list contains exactly this one fixture customer. Deleting a test clock also deletes its customer/subscriptions. Non-clock cleanup expires the fixture's open Checkout and deletes only its fixture customer. The local evidence ledger remains. Cleanup refuses unrelated or shared objects instead of deleting them.

The harness creates no production member, subscription, AX balance or device license. Its fixture agreements do not approve the customer-facing draft, and its passing results cannot turn production readiness true.

## References

- [Stripe automated testing](https://docs.stripe.com/automated-testing)
- [Sandbox testing](https://docs.stripe.com/testing/overview)
- [Billing tests](https://docs.stripe.com/billing/testing)
- [Test clock API and limitations](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage)
- [Webhook setup and signature verification](https://docs.stripe.com/webhooks/quickstart)

Local guard tests make no Stripe API calls and do not count as real-provider evidence:

```sh
node --test services/bridge-platform/sandbox-e2e.test.cjs
```
