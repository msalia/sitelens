# Data Processing Agreement (DPA)

> **TEMPLATE — REQUIRES LEGAL REVIEW.** This DPA is a working draft for KeshavTech
> (operator of SiteLens). Fill every `[TODO: …]` and have counsel review before
> use. Version 1.0 (draft) · Last updated: June 11, 2026.

This Data Processing Agreement ("DPA") forms part of the Terms of Service (the
"Agreement") between:

- **Processor:** KeshavTech, [TODO: ENTITY ADDRESS] ("KeshavTech", "we"), operator
  of the SiteLens service (the "Service"); and
- **Controller:** the customer organization that uses the Service (the "Customer").

Where KeshavTech processes personal data on the Customer's behalf, the Customer is
the **controller** and KeshavTech is the **processor**. This DPA reflects Article
28 of the EU GDPR and the UK GDPR.

## 1. Definitions

Terms such as "personal data", "processing", "controller", "processor",
"sub-processor", "data subject", "personal data breach", and "supervisory
authority" have the meanings given in the GDPR.

## 2. Scope and roles

2.1 KeshavTech processes Customer Personal Data only to provide the Service and
only on the Customer's documented instructions, including the instructions set out
in the Agreement, this DPA, and the Customer's configuration and use of the
Service.

2.2 KeshavTech will inform the Customer if, in its opinion, an instruction
infringes the GDPR or other data-protection law.

2.3 The subject matter, duration, nature, and purpose of processing, the types of
personal data, and the categories of data subjects are described in **Annex I**.

## 3. Processor obligations (Art. 28(3))

KeshavTech will:

- **(a) Instructions.** Process Customer Personal Data only on the Customer's
  documented instructions, including regarding international transfers, unless
  required by law (in which case it will inform the Customer unless legally
  prohibited).
- **(b) Confidentiality.** Ensure persons authorized to process the data are bound
  by confidentiality.
- **(c) Security.** Implement the technical and organizational measures in
  **Annex II** (Art. 32).
- **(d) Sub-processors.** Engage sub-processors only under Section 5.
- **(e) Data-subject rights.** Taking into account the nature of processing, assist
  the Customer by appropriate measures to respond to data-subject requests
  (access, rectification, erasure, restriction, portability, objection). The
  Service provides self-service tooling for many of these (see Section 9).
- **(f) Assistance.** Assist the Customer in ensuring compliance with Art. 32–36
  (security, breach notification, DPIAs, prior consultation), considering the
  information available to KeshavTech.
- **(g) Deletion/return.** On termination, at the Customer's choice, delete or
  return Customer Personal Data and delete existing copies, unless retention is
  required by law. Deleting a project or organization in the Service permanently
  removes its data and uploaded files.
- **(h) Audits.** Make available information necessary to demonstrate compliance
  with Art. 28 and allow for and contribute to audits, including inspections, by
  the Customer or an auditor it mandates, subject to reasonable confidentiality
  and security conditions.

## 4. Security (Art. 32)

KeshavTech maintains the technical and organizational measures described in
**Annex II**, appropriate to the risk.

## 5. Sub-processors

5.1 The Customer provides **general authorization** for KeshavTech to engage
sub-processors. The current list is published at **/subprocessors** (and in
[SUBPROCESSORS.md](./SUBPROCESSORS.md)).

5.2 KeshavTech will give the Customer at least **30 days' notice** of any intended
addition or replacement of a sub-processor (via the Service or email), during
which the Customer may object on reasonable data-protection grounds. If the
parties cannot resolve the objection, the Customer may terminate the affected part
of the Service.

5.3 KeshavTech imposes on each sub-processor data-protection obligations no less
protective than those in this DPA (flow-down) and remains liable for its
sub-processors' performance.

## 6. International transfers

Where Customer Personal Data is transferred outside the EEA or UK to a country
without an adequacy decision, the transfer is governed by the European Commission's
**Standard Contractual Clauses (SCCs)** (and the UK International Data Transfer
Addendum where the UK GDPR applies), which are incorporated by reference, together
with any supplementary measures identified by a transfer impact assessment. See
**Annex III** for the relevant SCC modules per sub-processor.

## 7. Personal data breach

KeshavTech will notify the Customer **without undue delay** after becoming aware of
a personal data breach affecting Customer Personal Data, with the information the
Customer reasonably needs to meet its own Art. 33/34 obligations. KeshavTech's
internal process is documented in [BREACH_RESPONSE.md](./BREACH_RESPONSE.md).

## 8. Duration

This DPA applies for as long as KeshavTech processes Customer Personal Data under
the Agreement.

## 9. How the Service supports data-subject rights

- **Erasure** — admins can remove users; deleting a project or the organization
  permanently purges its data and uploaded files.
- **Rectification** — users can edit their account details.
- **Portability** — projects can be exported as a portable archive.
- **Access/restriction/objection** — supported on request via the Customer's admin
  or KeshavTech support at [TODO: CONTACT EMAIL].

## 10. Liability and governing law

Liability is subject to the limitations in the Agreement. This DPA is governed by
[TODO: GOVERNING LAW].

---

## Annex I — Description of processing

| Item                            | Description                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Subject matter**              | Provision of the SiteLens coordinate-tie and 3D visualization service.                                                                                                                                                                                             |
| **Duration**                    | For the term of the Agreement and until data is deleted/returned.                                                                                                                                                                                                  |
| **Nature & purpose**            | Hosting, storing, processing, and displaying Customer data to operate the Service; sending transactional email (verification, password reset, invitations).                                                                                                        |
| **Types of personal data**      | User email addresses; organization name; authentication metadata (e.g. sign-in events, verification status). Project/survey data (grids, control points, survey points, drawings) is generally business/geospatial data and not intended to contain personal data. |
| **Categories of data subjects** | The Customer's users (employees, contractors, invited collaborators).                                                                                                                                                                                              |
| **Special categories**          | None intended or requested.                                                                                                                                                                                                                                        |

## Annex II — Technical and organizational measures (Art. 32)

> Keep this in sync with the actual deployment. `[TODO: …]` items need confirmation.

- **Access control & authentication.** Email/password sign-in; passwords stored
  only as **Argon2** hashes (never plaintext); HTTP-only, secure session cookies;
  single-use, expiring tokens for verification/reset/invites; rate limiting on
  sensitive endpoints.
- **Authorization.** Role-based access (Admin / Surveyor / Viewer) and strict
  **per-organization (tenant) isolation** enforced server-side on every query.
- **Encryption.** TLS in transit. [TODO: confirm encryption at rest for the
  database and uploaded files at the hosting/storage layer.]
- **Data minimization.** Only an email + organization name are collected as
  identity data; no tracking/advertising cookies.
- **Segregation.** The application API is not exposed publicly; only the web tier
  reaches it.
- **Deletion.** Project/organization deletion removes database rows (FK cascade)
  and purges associated uploaded files.
- **Backups & recovery.** [TODO: describe backup cadence, retention, and
  restoration testing for the hosting environment.]
- **Logging & monitoring.** [TODO: describe what is logged and how breaches are
  detected; see BREACH_RESPONSE.md.]
- **Personnel.** Access limited to authorized personnel bound by confidentiality.

## Annex III — Authorized sub-processors

See [SUBPROCESSORS.md](./SUBPROCESSORS.md) / **/subprocessors** for the live list,
including each sub-processor's purpose, location, and transfer mechanism (SCC
module / adequacy).
