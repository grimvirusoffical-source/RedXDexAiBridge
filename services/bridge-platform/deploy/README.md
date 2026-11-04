# Private Bridge platform deployment

This runbook packages the existing production entrypoint. It does not deploy it, provision credentials, replace account authority, enable sales, or change public routing. The supplied configuration is deliberately incomplete and must fail closed. Do not turn missing readiness evidence into true values.

## Source and existing services

The service source baseline is Bridge 9b2cb61c920d89bed845d460bb2d5aaddb6d11c7. Install only a reviewed immutable release tree, including services/bridge-platform, app/legal-content.cjs and app/platform-config.cjs, under /opt/red-xai/bridge-platform/releases/<reviewed-commit>. A root-controlled current symlink selects it. Install the locked service dependencies with npm ci --omit=dev --ignore-scripts --no-audit --no-fund. Confirm the actual Node executable is Node20 or newer before using the unit's /usr/bin/node.

The sole production console coordinator must verify host identity, existing PID/start-time/unit identities and the availability of TCP17783 before installing or starting this separate service. The server accepts an integer port from1 through65535, defaults to17783, and always listens on127.0.0.1. Port0, string ports and public-address configuration are unsupported. The example native DB port17791 is also only a proposal: confirm a free private port and the actual dedicated native service before using it.

Do not stop, replace or upgrade the original bcc6c62 account engine, the existing native website DB, GenDragoon, Vortex, Quick Login, Host, CMS, mail or tunnel units. Do not use their database paths or canonical account namespaces for this service. No unit here depends on or restarts those customer services.

For the Bridge storage capability, use only the reviewed host-only c5fe8744ee21a8a3ec7c2f8beeea25ffa380df29 candidate, merged as acddd62861b438ccf6e1013c9178138774848e5a, after actual deployed-baseline parity and its release provenance/hash manifest have been checked by the coordinator. The prepared Linux binary receipt records SHA25657b0b42c1ddaa628a977f00457e094b3e84fcbd6b4bf941e86c3840d103ef028. Do not deploy the entire newer RedX main feature stack, an engine-changing candidate, or a different account binary merely to obtain record-CAS. This host-only change preserves the existing engine and formats; source tests alone are not deployment proof.

## Protected configuration and real authority

bridge-platform.config.example.json lists the unchanged factory fields. Its empty ownerSubjects, missing webhook ID, draft approval and unconfigured authority intentionally prevent startup. It is not a working production configuration.

The private authority.cjs module must come from the actual deployed account authority. It must implement resolvePrivileges, revokeBridgeSession, deleteBridgeMembership, deleteAccount, moderate, trustedIP, verifyCSRF and verifyDeploymentReadiness. It must perform and independently verify the actual scoped operations. Supply no stub, fixture identity, synthetic owner, hardcoded successful receipt or manufactured MFA timestamp. Subscription cancellation remains wired to this service's actual verified Stripe ledger by the factory. The native account realm and a fresh account prototype are not interchangeable.

Set ownerSubjects only from verified immutable subjects in the existing authority. A username/email match, root console, cached Quick Login profile or requested role does not prove owner/MFA privileges. App authorization needs the existing verified issuer/client/scope and device proof. Current Quick Login cached grant validation does not by itself prove current central status, account deletion, session epoch or canonical app-membership removal.

Install runtime.env outside Git. It supplies BRIDGE_CONFIG_FILE as an absolute protected JSON path and STRIPE_RESTRICTED_KEY through the approved private credential intake. Provision the correct mode-specific key without displaying it, placing it in a command argument, shell history, issue, artifact or log. The unit defaults BRIDGE_ENABLE_LIVE_PAYMENTS to no. An explicitly reviewed live runtime.env may enable it only after the complete activation procedure; an environment file can override the unit default.

Config, authority modules, the scoped RedX credential, Ed25519 license private key, independent IP-HMAC key, raw webhook secret and live catalog file must be private regular files outside the repository. The factory rejects symlinks and group/other-readable files on POSIX. Use an administrative directory owned by root with only the dedicated service group allowed to traverse it, and private0400/0600 files readable by the dedicated service UID; keep directory entries administrator-controlled. systemd reads the root-only0600 runtime.env. Alternatively use an independently reviewed protected credential projection preserving the same absolute-file contract. The service's ProtectSystem=strict makes /etc and release source read-only at runtime. Do not chmod/chown existing account stores or expose their keys to this user.

The only mutable service path in the unit is /var/lib/red-xai-bridge-platform, used for the configured plugin media. The dedicated RedX instance must have separate paths, keys, configuration and unit. Node's outbound HTTPS access to Stripe and the account authority is required; loopback-only here restricts the inbound listener, not required outbound requests.

## Isolated native database and cold initialization

Provision a new logical database such as bridge_platform_v1 using the reviewed native administration path. Configure the exact physical name returned by provisioning, including any t<ten-lowercase-hex>_ tenant prefix. Do not derive or strip that prefix. Canonical account names, unrelated namespaces, missing names and invalid tenant names are rejected.

Provision exactly one cold persistent rxa-bridge-platform.red-xai.db file. The reviewed host requires standalone leader mode, sync/group durability, no active Pulse rules, no peers, cluster secrets, members or promoted history, and supported native storage. Give the application a DB/path-scoped write credential, not an administrator credential. Keep provisioning/admin credentials out of the Node runtime. Verify marked record-CAS capability, native-file durability receipts and isolation on the actual dedicated instance before customer work.

The production factory does not initialize a ledger. A marked record_not_found read becomes schema1/revision0 in memory. Public GET readiness is read-only and requires the current native record to have revision greater than0 and the exact key bridge-platform-v1. Therefore repeated readiness GETs cannot initialize an empty ledger. An authenticated /me or /account/join transaction can create it, but an activation client may correctly refuse application work until readiness passes.

To avoid that circular dependency, the existing server-only platform.withBillingState transaction can perform one explicit empty-ledger initialization. Run it only as the dedicated service UID through a reviewed private maintenance environment after real factory authority, legal, key and billing prerequisites are present, with the service and ingress still stopped. Do not add a public bootstrap route. The following snippet uses the same factory, scoped credential, record-CAS implementation and native acknowledgement checks; it creates empty billing/catalog state, no account, owner, plan, balance, purchase or entitlement:

    'use strict';
    const {createProductionService,privateFile}=require('./server.cjs');
    const {RedXStore}=require('./store.cjs');
    (async()=>{
      const service=await createProductionService();
      const config=JSON.parse(privateFile(process.env.BRIDGE_CONFIG_FILE));
      const store=new RedXStore({
        base:config.redxOrigin,
        key:privateFile(config.redxCredentialFile).trim(),
        database:config.database
      });
      const before=await store.load();
      if(before.revision!==0){
        console.log('Existing Bridge ledger retained');
        return;
      }
      await service.platform.withBillingState(()=>undefined);
      const after=await store.load();
      if(after.key!=='bridge-platform-v1'||after.revision<1)
        throw Error('Initialization unconfirmed');
      console.log('Bridge ledger initialized through native record-CAS');
    })().catch(()=>{
      console.error('Bridge ledger initialization unavailable');
      process.exitCode=1;
    });

Invoke reviewed script bytes over protected stdin from services/bridge-platform; never put credential values in the invocation. It must run without an externally reachable listener and without other application writers. Do not initialize from a copied fixture ledger or restore stale state over a current record. A record collision, unknown-route404, unsupported receipt or post-commit uncertainty must stop the procedure. The snippet is a supported-API maintenance procedure, not evidence that it has been executed successfully on production.

Initialization proves neither conflict handling nor restart durability. Separately record an actual current scoped read, an authorized pre-commit stale-revision409 without changing the current record, and preserved state after a coordinated restart of only the dedicated native instance before customer traffic. Validate account/device isolation and restore in a separate empty recovery environment. Record exact namespace, file, revisions, local native-file watermarks and binary hashes without credentials or profile contents. Keep these real evidence receipts available to the actual authority readiness adapter; never replace them with literal true values.

## Back up before changes

Before creating any public route or replacing a dedicated Bridge binary/configuration, preserve the existing units, release selection, private configuration, media, signing keys, scoped credential and dedicated native state using the approved protected/encrypted backup and off-server verification procedure. Preserve numeric owners, modes, ACLs, xattrs, mounts and matching executables where required. Keep decryption identities separate. Verify authenticated archive integrity and an isolated recovery; a live filesystem copy does not by itself establish application consistency.

The historical account artifact/configuration snapshot is not an account/session database backup. Original account recovery is a separate coordinated operation covering canonical and GenDragoon writers and their namespace aliases. Do not run a second engine, omit a protected child, change its permissions, force a backup or claim the website DB archive covers that account realm. This deployment does not authorize any original-account maintenance.

Install the new systemd file only after validating its paths/user and using systemd-analyze verify on the actual Linux host. It is intentionally not enabled by this repository. The runner drains active HTTP responses on SIGTERM/SIGINT, stops admission, and exits cleanly after successful close. Its30-second deadline closes remaining connections and exits with failure; systemd's40-second stop limit is the outer bound. Generic startup/stop errors contain no configuration, account or credential details. An interrupted webhook must remain an unacknowledged/reconcilable provider delivery, never a claimed successful payment.

## Verify privately, then review exact ingress

Keep all testing on loopback until the factory starts with real dependencies and private readiness behavior is understood. Preserve Host:red-xai.com for application requests. A listening process is not readiness; an initialized database is not account, legal, usage or payment readiness. Factory and readiness guards are unchanged.

Current live observations may instead show302 to /signin, HTML,404, unavailable service or a gateway response. Distinguish these missing/wrong-routing states from HTTP200 JSON with ready:false. A conforming readiness response identifies app bridge, issuer https://red-xai.com, live billing, the reviewed legal version, and every named check true. Public probes do not perform destructive verification.

After private acceptance, the sole coordinator may review a narrowly scoped route to the existing handler prefix /redxai-bridge/api. Preserve the original Host and HTTPS origin, native bearer/device headers and existing browser CSRF handling. The exact GET /redxai-bridge/api/readiness must reach the service's public allowlisted-capabilities route without the site's sign-in redirect. The exact POST /redxai-bridge/api/stripe/webhook must deliver the unchanged raw body and Stripe signature to its provider verifier without an interactive site login. All remaining platform authentication and authorization stays in the existing handler; these two path-specific requirements do not permit disabling site authentication, rewriting unrelated ingress, trusting client-supplied identity headers or bypassing CSRF.

The eight existing live Stripe products/prices are staged inactive. Their existence is not active checkout. Protected runtime credentials, an actual signed webhook and delivery receipt, account/order reconciliation, and production operational evidence still need verification. Preserve other-app products and portals. Keep real charges and product activation off until that procedure and the approved business/legal details are complete. A Sandbox server cannot claim overall live readiness.

The currently shipped0.10.20 app is intentionally inactive. Production usage readiness also requires the separately reviewed client enforcement/transport configuration. Do not edit a deployed source flag to manufacture readiness or issue an activation release from this deployment scaffold. The normal activation update must pass its strict publication checks against the deployed service.

## Rollback and recorded completion

On failure, retain current ledger and payment/provider evidence. Stop only the new Bridge unit, remove or reverse only its reviewed new ingress route, and restore the previous dedicated service release/configuration under the approved plan. Restore database state only through a separately reviewed reconciliation/recovery procedure; rolling code back never authorizes replacing current financial state with an old archive. Preserve other-app sessions and all original services.

Record deployed commit and tree, dependency lock, exact native binary and namespace, private/public readiness distinction, accepted account/MFA/device flows, legal version, actual signed payment/grant/renewal/refund/cancellation results, archive integrity/restore and restart evidence. No step in this source-only runbook is a completion claim.
