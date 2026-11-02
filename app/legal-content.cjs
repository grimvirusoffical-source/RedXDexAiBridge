'use strict';
// Draft text for owner/legal review. Deployment must explicitly approve this
// version with the real business identity and applicable consumer terms.
module.exports={
 version:'bridge-2026-11-v1',status:'draft',requiresReview:true,
 documents:[
 {id:'terms',title:'Terms of Service',content:`DEVICE-ONLY PLUGIN LICENSES

A purchased Bridge plugin activates on one enrolled device at a time. It is not an unlimited-device license. The purchase is recorded on your Red-XAI account. Eligible verified recovery can reassign an activation up to three times in a rolling year; a successful reassignment revokes the prior device activation. Account details alone do not guarantee recovery. Keep your account and recovery information current.

USING BRIDGE

Bridge connects an AI client to capabilities that you choose on your computer. A Red-XAI sign-in does not by itself authorize a remote client or grant a tool permission. Each client must be paired and approved separately. Review requested capabilities, use limited folders and scoped terminal or crawler connections where appropriate, and stop computer control when you do not need it. You remain responsible for the instructions you give and the services you authorize.

SUBSCRIPTIONS AND ALLOWANCES

Each Red-XAI subscription lists the apps and benefits it includes. Bridge allowances measure authenticated active working time and eligible crawler or terminal usage. Idle connections and time spent waiting for a human approval do not run the active-work clock. Allowances reset at the published weekly boundary. They do not roll over unless your plan expressly says so. Unlimited active-time benefits do not remove safety, request-rate, concurrency, storage or network limits. Third-party AI model or subscription fees are separate unless expressly included.

PURCHASES AND ACCOUNT CREDITS

Review the final amount, currency, recurrence, device restriction and cancellation terms at checkout. Axioms are closed-loop credits for eligible Red-XAI purchases, not an investment, cryptocurrency or a promise of cash value. They cannot be cashed out or transferred to another person through Bridge. Paid entitlements begin only after payment verification. Refunds, disputes and chargebacks can reverse related credit or entitlements. Any non-waivable consumer rights still apply.

ACCOUNT SAFETY AND SERVICE CHANGES

Do not use Bridge to access a device, account or network without permission, defeat security controls, harass people, violate privacy, or distribute harmful software. Authorized moderators may impose app-specific or account-wide restrictions under the published policy, with a reason and an end date or permanent status. A restriction may stop active sessions. Feature availability, supported operating-system capabilities and third-party integrations can change; review release notes and service notices.

LIMITATIONS AND CONTACT

Software and AI results can fail or be inaccurate. Keep independent backups and verify important results before relying on them. Bridge does not guarantee that an AI task is correct or that an external action can be undone. Nothing in these terms excludes rights or liabilities that applicable law does not permit to be excluded. The published service must identify the responsible business, support contact, refund/cancellation policy and applicable jurisdiction before live paid sales are enabled.`},
 {id:'privacy',title:'Privacy Policy',content:`WHAT BRIDGE PROCESSES

Bridge uses your canonical Red-XAI account identifier and the profile fields needed for sign-in, purchases, subscriptions, moderation and support. Device enrollment records associate a public device identity with your account; private signing credentials remain in protected local storage. The account service records legal-acceptance versions and times, entitlement events, usage measurements and security audit records.

YOUR COMPUTER AND CONNECTED AI CLIENTS

Approved operations can transmit file contents, screenshots, terminal output, crawler results or other requested material to the AI client you connected. Only grant access you intend to share, and read that client's privacy terms. Folder permissions and scoped connections reduce exposure but do not make a general terminal a security sandbox. Emergency stop and permission revocation remain available. Bridge should not place passwords, API secrets, raw typed text or private file contents in routine activity logs.

PAYMENTS AND AXIOMS

Stripe processes checkout information under its own privacy terms. Bridge records payment references, amounts, verification states, credit-ledger entries and resulting entitlements. Payment-card details are entered in the secure checkout flow; they are not entered into the Bridge plugin form or ordinary desktop settings. Owner payment credentials and webhook secrets remain on the server and are never displayed to regular users.

SECURITY AND MODERATION DATA

The account service may retain connection, device and IP-association information for account security and proportionate abuse prevention. IP addresses can identify a shared network rather than a single person, and may change. Search and moderation access is restricted to authorized staff, with audit records. Administrator status does not authorize action against the owner or another administrator where the service's role policy prohibits it.

RETENTION, DELETION AND RECOVERY

Resetting Bridge stops its active sessions, clears local sign-in persistence and requires a fresh agreement review after the next sign-in. Bridge-only deletion removes the Bridge registration and applicable active app data; deleting the entire Red-XAI account affects the wider account. Some financial, fraud-prevention, security or legally required records may remain for the documented retention period. A verified plugin recovery revokes the previous activation and records the reassignment event. Recovery may require recent sign-in, MFA and support verification.

YOUR CHOICES AND PUBLISHED DETAILS

You can review permissions, revoke clients, sign out and request the supported deletion scope. Privacy and access rights depend on the applicable law and the actual service operation. The published policy must name the data controller, privacy contact, retention periods, subprocessors, international-transfer arrangements and the process for exercising rights before live collection under this version is enabled. This draft does not assert certifications, legal compliance or retention practices that have not been verified.`},
 {id:'agreement',title:'User Agreement',content:`BEFORE CONNECTING AN AI

Use Bridge only on computers and accounts you own or are authorized to operate. Sign-in verifies your Red-XAI account; it does not replace local operating-system consent or a client's separate pairing approval. Check each client's name, the requested operation, and the capabilities you grant. A terminal-only or crawler-only credential must not be treated as permission for full desktop control.

DEVICE LICENSE ACKNOWLEDGEMENT

I understand that a paid plugin purchase is for one enrolled device at a time. It is saved to my Red-XAI account but does not automatically activate on every computer I use. Verified recovery may reassign the license no more than three times in a rolling year and disables the old activation. I will keep my account recovery details accurate and secure; the service may require additional evidence before reassigning a license.

WORKING TIME AND BACKGROUND TASKS

I understand the plan's active-time, terminal and crawler allowances and the published weekly reset time. Background work is different from full application exit: permitted tasks may continue while the app is hidden, but quitting, sign-out, a reset, sleep or loss of connection can interrupt them. A job that performs an external action is not automatically reversible, and an interrupted job is not guaranteed to resume after a restart. I will check the result of important work.

PURCHASE AND SUBSCRIPTION CHOICES

I will review one-time versus recurring charges, the final checkout amount, device restrictions and the subscription's included app benefits before purchasing. Axioms use two decimal places at the published exchange rate and are usable only for eligible Red-XAI purchases. A checkout return page alone does not prove that payment succeeded. Expired or revoked subscriptions cease granting their active benefits; required transaction and audit history can remain.

RESET, SIGN-OUT AND DELETION

Resetting this Bridge signs it out even if a prior browser approval requested that it stay signed in. After a reset, a new sign-in requires review and acceptance of the current agreements for the reset enrollment. Bridge-only account deletion and entire Red-XAI account deletion are distinct choices with different effects. Sensitive deletion, recovery or moderation actions may require recent authentication or MFA.

ACKNOWLEDGEMENT

The application asks me to review the complete Terms of Service, Privacy Policy and this User Agreement, mark that I have read them and separately indicate agreement. The service records that acceptance action with the current document version. A scroll marker is not a claim that I understood every provision. I can contact the published support channel with questions before accepting, and mandatory rights under applicable law are not waived by this acknowledgement.`}
 ]
};
