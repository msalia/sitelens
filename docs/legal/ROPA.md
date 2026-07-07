# Records of Processing Activities (RoPA)

> **TEMPLATE — REQUIRES REVIEW.** KeshavTech LLC's processor record for SiteLens under
> GDPR Art. 30(2). Keep current; review whenever processing, sub-processors, or
> security measures change. Last updated: June 11, 2026.

## 1. Processor identity

- **Processor:** KeshavTech LLC, 510 Perrineville Road, Hightstown, NJ 08520, USA
- **Contact:** privacy@msalia.org (privacy/legal); security@msalia.org (security)
- **Data Protection Officer:** Mukund Salia — privacy@msalia.org, (650) 334-5493
- **EU/UK representative (Art. 27):** [TODO: required only if the Service is offered
  to data subjects in the EU/UK — decide and appoint if so]

## 2. Controllers on whose behalf we process

Each customer **organization** using SiteLens is a controller. Identity/contact for
each is held in the account/billing records. [TODO: confirm where the controller
list is maintained.]

## 3. Categories of processing carried out per controller

- Hosting and storage of organization and project data.
- User authentication and authorization (sign-in, roles, per-org isolation).
- Sending transactional email (verification, password reset, invitations).
- Deletion/erasure on request (project/organization deletion purges data + files).
- Export of project data on request (portability).

## 4. Categories of data & data subjects

| Category                           | Examples                                           | Data subjects                                 |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Identity/account                   | Email address, organization name                   | Customer users (staff, contractors, invitees) |
| Authentication metadata            | Verification status, sign-in events, password hash | Customer users                                |
| Project/geospatial (business data) | Grids, control points, survey points, drawings     | Generally not personal data                   |

No special-category data is intended or requested.

## 5. Sub-processors & international transfers

SiteLens is self-hosted on KeshavTech LLC's own infrastructure in the **United States**
(no third-party hosting sub-processor). See [SUBPROCESSORS.md](./SUBPROCESSORS.md).
Summary:

| Recipient      | Country       | Safeguard                                          |
| -------------- | ------------- | -------------------------------------------------- |
| Resend (email) | United States | DPA + EU SCCs (Module 3); UK IDTA where applicable |

Because KeshavTech LLC itself processes data in the US, EEA/UK→US transfers to
KeshavTech LLC rely on the EU SCCs (Module 2) / UK IDTA.

## 6. Retention

Data is retained while the account/organization is active and as needed to provide
the Service. On deletion of a project, user, or organization, the associated data
and uploaded files are permanently removed. [TODO: confirm backup retention window
and how deletions propagate to backups.]

## 7. General description of security measures (Art. 32)

See [DPA.md](./DPA.md) Annex II — Argon2 password hashing, TLS in transit,
role-based access, per-organization isolation, single-use/expiring tokens, rate
limiting, non-public API tier, and erasure tooling. [TODO: confirm encryption at
rest and backup practices at the hosting layer.]
