'use strict';
// Draft text for owner/legal review. Deployment must explicitly approve this
// version with the real business identity and applicable consumer terms.
module.exports={
 version:'bridge-2026-11-v1',status:'draft',requiresReview:true,
 // Owner approved these business-policy proposals on 2026-11-02. This is not
 // approval of the complete agreements or evidence of deployed enforcement.
 policyDecisions:{status:'approved-for-implementation',approvedDate:'2026-11-02',
  refunds:{pluginRequestDays:14,whollyUnspentAxiomTopupRequestDays:14,firstSubscriptionChargeRequestDays:7},
  retention:{verifiedAccountDeletionDays:30,rawSecurityIpDays:30,hashedIpAssociationDays:90,endedBanDays:90,permanentBanReviewMonths:12,detailedUsageWeeks:8,recoveryMonths:13,auditMonths:12,supportAfterClosureMonths:12,backupPurgeGoalDays:30,minimalFinancialYears:7},
  exceptions:'Active bans, documented legal holds, financial obligations and applicable mandatory rights retain their draft qualifications.',
  legalOperatorAndPublicAddress:'Operator name separately supplied by owner: Red-XAI LLC. Public business contact address remains unprovided; full agreement approval is pending.',publicationReady:false},
 // The operator name and contacts are owner-supplied, not independently verified
 // formation evidence. The proposed policies below are not reviewed businessDetails.
 businessDetails:{
  businessLabel:'Red-XAI LLC',
  formationStatus:'Registration in progress in New Mexico, United States.',
  legalName:'Red-XAI LLC',supportContact:'support@infected-nation.com',privacyContact:'support@infected-nation.com',
  refundPolicy:null,cancellationPolicy:null,jurisdiction:null,retentionPeriods:null,
  subprocessors:null,internationalTransfers:null,rightsProcess:null
 },
 documents:[
 {id:'terms',title:'Terms of Service',content:`DEVICE-ONLY PLUGIN LICENSES

A purchased Bridge plugin activates on one enrolled device at a time. It is not an unlimited-device license. The purchase is recorded on your Red-XAI account. Eligible verified recovery can reassign an activation up to three times in a rolling year; a successful reassignment revokes the prior device activation. Account details alone do not guarantee recovery. Keep your account and recovery information current.

BUSINESS DETAILS AND DRAFT STATUS

The owner-supplied operator name for this draft is Red-XAI LLC. Registration was described as in progress in New Mexico, United States; completed formation has not been independently verified. Support and privacy contact: support@infected-nation.com. The public business contact address and governing-law or venue terms still require confirmation before publication. The registration location is not a choice-of-law provision.

This version is a draft for review. The refund windows, cancellation terms and retention schedule below are proposed business policies whose final review and operational implementation are pending. They are not a statement that these policies are live, that a refund is automatically approved, or that the proposed cleanup deadlines have already been implemented. Mandatory rights under applicable law are unaffected by this draft.

USING BRIDGE

Bridge connects an AI client to capabilities that you choose on your computer. A Red-XAI sign-in does not by itself authorize a remote client or grant a tool permission. Each client must be paired and approved separately. Review requested capabilities, use limited folders and scoped terminal or crawler connections where appropriate, and stop computer control when you do not need it. You remain responsible for the instructions you give and the services you authorize.

SUBSCRIPTIONS AND ALLOWANCES

Each Red-XAI subscription lists the apps and benefits it includes. Bridge allowances measure authenticated active working time and eligible crawler or terminal usage. Idle connections and time spent waiting for a human approval do not run the active-work clock. Allowances reset at the published weekly boundary. They do not roll over unless your plan expressly says so. Unlimited active-time benefits do not remove safety, request-rate, concurrency, storage or network limits. Third-party AI model or subscription fees are separate unless expressly included.

PURCHASES AND ACCOUNT CREDITS

Review the final amount, currency, recurrence, device restriction and cancellation terms at checkout. Axioms are closed-loop credits for eligible Red-XAI purchases, not an investment, cryptocurrency or a promise of cash value. They cannot be cashed out or transferred to another person through Bridge. Paid entitlements begin only after payment verification. Refunds, disputes and chargebacks can reverse related credit or entitlements. Any non-waivable consumer rights still apply.

PROPOSED PLUGIN REFUNDS — REVIEW AND IMPLEMENTATION PENDING

The proposed policy would allow a refund request for a paid plugin within 14 days of its purchase. An approved refund would revoke the purchased plugin entitlement and its device activation, including any reassigned activation. A refund would not allow continued use of the refunded plugin. An approved refund for a plugin purchased with Axioms would return the approved amount as Axioms to the same Red-XAI account; it would not create a right to cash out Axioms. Stripe payment refunds would be submitted to the original payment method, not to a different card, bank account or Axiom balance. A failed refund would require support review with the processor rather than an automatic change of destination.

PROPOSED SUBSCRIPTION CANCELLATION AND REFUNDS — REVIEW PENDING

The proposed policy would allow a refund request within seven days of the first subscription charge. Later renewals would not have the same routine first-charge refund window. Support would still review service faults, duplicate or incorrect charges, and any remedy required by applicable law. A subscriber could cancel at any time to stop future renewal; cancellation would ordinarily take effect at the end of the already paid period, with benefits available until that period ends. Cancellation alone would not automatically prorate or refund the current period. An approved refund or other payment reversal could end the related benefits earlier. Expired or revoked subscription benefits would be removed from active account access while necessary financial and audit history remains.

PROPOSED AXIOM TOP-UP REFUNDS AND REQUEST PROCESS

The proposed policy would allow a request within 14 days for a top-up that is wholly unspent, returning an approved refund through the original payment method. Support would verify the top-up and its funding history; a partly spent top-up would not qualify under this routine wholly-unspent proposal. A refund of a payment used to buy Axioms is different from cashing out an Axiom balance. Account credits cannot be transferred or exchanged for cash through Bridge. Faults, incorrect charges and mandatory legal remedies would still be reviewed separately.

For review purposes, requests would be sent to support@infected-nation.com with the account and relevant order reference. Do not email passwords, MFA codes or complete card details. Support approval and verified payment reconciliation would be required; there is currently no automatic customer refund-approval interface. The request windows are not guarantees of when a bank or processor will complete a refund. Pending or failed refunds and any existing dispute or chargeback would require support reconciliation to avoid duplicate reimbursement. The dedicated support workflow for returning Axioms on an Axiom-paid plugin refund still needs implementation and verification before this proposal can be published as an available service.

ACCOUNT SAFETY AND SERVICE CHANGES

Do not use Bridge to access a device, account or network without permission, defeat security controls, harass people, violate privacy, or distribute harmful software. Authorized moderators may impose app-specific or account-wide restrictions under the published policy, with a reason and an end date or permanent status. A restriction may stop active sessions. Feature availability, supported operating-system capabilities and third-party integrations can change; review release notes and service notices.

LIMITATIONS AND CONTACT

Software and AI results can fail or be inaccurate. Keep independent backups and verify important results before relying on them. Bridge does not guarantee that an AI task is correct or that an external action can be undone. Nothing in these terms excludes rights or liabilities that applicable law does not permit to be excluded. Contact support@infected-nation.com with questions about this draft. The remaining public business details for Red-XAI LLC, formation status, applicable jurisdiction, approved refund and cancellation terms, and the corresponding operational processes must be confirmed before this version can be published or used to enable live paid sales.`},
 {id:'privacy',title:'Privacy Policy',content:`WHAT BRIDGE PROCESSES

Bridge uses your canonical Red-XAI account identifier and the profile fields needed for sign-in, purchases, subscriptions, moderation and support. Device enrollment records associate a public device identity with your account; private signing credentials remain in protected local storage. The account service records legal-acceptance versions and times, entitlement events, usage measurements and security audit records.

BUSINESS AND PRIVACY CONTACT

The owner-supplied operator name for this draft is Red-XAI LLC. Registration was described as in progress in New Mexico, United States; completed formation has not been independently verified. Support and privacy questions can be directed to support@infected-nation.com. The public business contact address remains unresolved. This policy and the retention periods below are draft proposals for review; deployment and cleanup behavior must be verified before they are described as live practices.

YOUR COMPUTER AND CONNECTED AI CLIENTS

Approved operations can transmit file contents, screenshots, terminal output, crawler results or other requested material to the AI client you connected. Only grant access you intend to share, and read that client's privacy terms. Folder permissions and scoped connections reduce exposure but do not make a general terminal a security sandbox. Emergency stop and permission revocation remain available. Bridge should not place passwords, API secrets, raw typed text or private file contents in routine activity logs.

PAYMENTS AND AXIOMS

Stripe processes checkout information under its own privacy terms. Bridge records payment references, amounts, verification states, credit-ledger entries and resulting entitlements. Payment-card details are entered in the secure checkout flow; they are not entered into the Bridge plugin form or ordinary desktop settings. Owner payment credentials and webhook secrets remain on the server and are never displayed to regular users.

SECURITY AND MODERATION DATA

The account service may retain connection, device and IP-association information for account security and proportionate abuse prevention. IP addresses can identify a shared network rather than a single person, and may change. Search and moderation access is restricted to authorized staff, with audit records. Administrator status does not authorize action against the owner or another administrator where the service's role policy prohibits it.

RETENTION, DELETION AND RECOVERY

Resetting Bridge stops its active sessions, clears local sign-in persistence and requires a fresh agreement review after the next sign-in. Bridge-only deletion removes the Bridge registration and applicable active app data; deleting the entire Red-XAI account affects the wider account. Some financial, fraud-prevention, security or legally required records may remain for the documented retention period. A verified plugin recovery revokes the previous activation and records the reassignment event. Recovery may require recent sign-in, MFA and support verification.

PROPOSED RETENTION SCHEDULE — NOT YET A LIVE GUARANTEE

These are proposed business retention limits, not a claim that every period is required by law or already enforced by the service. The final data inventory, deletion jobs, backup lifecycle, access controls and exceptions must be reviewed and tested before publication. Retention should be limited to the necessary records and purpose; a longer justified exception should not retain an entire account indiscriminately.

Account and active app data: retain while the relevant account or app membership is active, then aim to delete or de-identify the applicable data within 30 days after a verified deletion request. A Bridge-only request would affect Bridge membership and active Bridge data while preserving other Red-XAI apps and account-wide financial records; it would not silently delete the entire Red-XAI account. Separate security, recovery, ban and financial records would follow the limited periods below. Expired subscription benefits would cease to grant active access; that would not erase the associated transaction history.

Security IP information: raw security IP records for 30 days; hashed IP associations for 90 days, unless an association is still needed for an active ban under the ban schedule below. A hashed association can remain linkable to a person or account and is not automatically anonymous.

Ban records and associated IP information: retain while a ban is active and for 90 days after it ends. Permanent bans would receive an annual necessity and proportionality review; they would not justify keeping unrelated personal data indefinitely.

Detailed usage records: eight weeks from the recorded activity. Verified device-license recovery events: 13 months from the event, supporting review of the rolling-year recovery limit. Security and administrator audit records: 12 months from the event. Support tickets: 12 months after the ticket is closed. Necessary transaction-linked records would be retained under the financial schedule rather than extending all activity or support records automatically.

Backups: a proposed rolling purge goal of 30 days after applicable production deletion, subject to verification of the actual backup lifecycle and restoration process. This is a goal awaiting implementation evidence, not a promise that all historical backup copies already disappear within 30 days. A restored backup would need the applicable deletion decisions reapplied before routine use.

Minimal financial and tax records: a proposed seven-year business retention period for the necessary transaction, invoice, refund, credit-ledger and tax records. The exact categories and start date must be confirmed with the business's accountant or legal reviewer. Seven years is a business proposal, not a universal legal requirement; tax and other duties can require different periods for different records. These records would be minimized and would not keep every profile field or active subscription benefit merely because a purchase occurred.

Documented legal holds, unresolved payment disputes or other specifically justified duties could require retaining limited relevant records longer. The reason, scope and continuing need would be reviewed, and the affected records would return to the appropriate deletion process when that justification ends. No general compliance certification is claimed by this proposal.

YOUR CHOICES AND PUBLISHED DETAILS

You can review permissions, revoke clients, sign out and request the supported deletion scope. Privacy and access rights depend on the applicable law and the actual service operation. For questions or a proposed privacy request, contact support@infected-nation.com without sending passwords or MFA codes. A safe identity-verification and rights-request process, including applicable response periods, still needs confirmation.

Before publication, the policy must confirm the responsible data-controller role and public contact details for Red-XAI LLC, complete subprocessors and processing locations, any applicable international-transfer arrangements, approved retention periods and the actual process for exercising rights. Stripe's payment processing is identified above, but this draft does not claim to supply a complete provider list, server region or transfer mechanism. This draft does not assert certifications, legal compliance or retention practices that have not been verified.`},
 {id:'agreement',title:'User Agreement',content:`BEFORE CONNECTING AN AI

Use Bridge only on computers and accounts you own or are authorized to operate. Sign-in verifies your Red-XAI account; it does not replace local operating-system consent or a client's separate pairing approval. Check each client's name, the requested operation, and the capabilities you grant. A terminal-only or crawler-only credential must not be treated as permission for full desktop control.

DEVICE LICENSE ACKNOWLEDGEMENT

I understand that a paid plugin purchase is for one enrolled device at a time. It is saved to my Red-XAI account but does not automatically activate on every computer I use. Verified recovery may reassign the license no more than three times in a rolling year and disables the old activation. I will keep my account recovery details accurate and secure; the service may require additional evidence before reassigning a license.

BUSINESS DETAILS AND REVIEW STATUS

The owner-supplied operator name for this draft is Red-XAI LLC. Registration was described as in progress in New Mexico, United States; completed formation has not been independently verified. Support and privacy contact: support@infected-nation.com. The public business contact address and remaining publication details require confirmation. I understand that this is a review draft and that its proposed refund windows and retention periods are pending final review and operational implementation, rather than live guarantees.

WORKING TIME AND BACKGROUND TASKS

I understand the plan's active-time, terminal and crawler allowances and the published weekly reset time. Background work is different from full application exit: permitted tasks may continue while the app is hidden, but quitting, sign-out, a reset, sleep or loss of connection can interrupt them. A job that performs an external action is not automatically reversible, and an interrupted job is not guaranteed to resume after a restart. I will check the result of important work.

PURCHASE AND SUBSCRIPTION CHOICES

I will review one-time versus recurring charges, the final checkout amount, device restrictions and the subscription's included app benefits before purchasing. Axioms use two decimal places at the published exchange rate and are usable only for eligible Red-XAI purchases. A checkout return page alone does not prove that payment succeeded. Expired or revoked subscriptions cease granting their active benefits; required transaction and audit history can remain.

The proposed refund policy for review is a 14-day paid-plugin request window with revocation on an approved refund; a seven-day request window for the first subscription charge; and a 14-day window for a wholly unspent Axiom top-up refunded through the original payment method. Subscription cancellation would stop future renewal at the end of the paid period without automatic proration. Other remedies for faults, incorrect charges or applicable law would be reviewed separately. An approved refund for an Axiom-paid plugin would return Axioms to the same account, not cash. These proposals require support review and verified implementation; this draft does not create an automatic refund interface or cash-out right. I can send questions to support@infected-nation.com without sharing passwords, MFA codes or complete card details.

RESET, SIGN-OUT AND DELETION

Resetting this Bridge signs it out even if a prior browser approval requested that it stay signed in. After a reset, a new sign-in requires review and acceptance of the current agreements for the reset enrollment. Bridge-only account deletion and entire Red-XAI account deletion are distinct choices with different effects. Sensitive deletion, recovery or moderation actions may require recent authentication or MFA.

ACKNOWLEDGEMENT

The application asks me to review the complete Terms of Service, Privacy Policy and this User Agreement, mark that I have read them and separately indicate agreement. The service records that acceptance action with the current document version. A scroll marker is not a claim that I understood every provision. I can contact the published support channel with questions before accepting, and mandatory rights under applicable law are not waived by this acknowledgement.`}
 ]
};
