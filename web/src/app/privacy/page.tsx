import { LegalPage } from '@/components/legal-page';

export const metadata = {
  description: 'How SiteLens handles your data.',
  title: 'Privacy Policy — SiteLens',
};

const CONTENT = `
This Privacy Policy explains what information SiteLens (the "Service") collects,
how we use it, and the choices you have. We are committed to the principles of the
EU General Data Protection Regulation (GDPR) and the UK GDPR, and have built the
Service around data minimization, security, and your control over your data. We
aim to collect only what we need to provide the Service.

## Who is responsible for your data

SiteLens is a multi-tenant tool used by organizations. Roles under data-protection
law depend on the data:

- **Project data you upload** (grids, control points, survey points, drawings).
  Your **organization is the data controller** and SiteLens acts as a **data
  processor**, handling that data on the organization's behalf and instructions.
- **Account and identity data** (your email, organization name, sign-in events).
  SiteLens is the controller for operating accounts and securing the Service.

If your organization is the controller, requests about project data are best
directed to your organization's administrator.

## Information we collect

- **Account information** — your email address and the organization name you
  provide when signing up or accepting an invite.
- **Organization and project data** — projects, building grids, control points,
  survey points, drawings, and other content you or your teammates create or
  upload.
- **Usage information** — basic technical information needed to operate the
  Service securely and reliably, such as authentication events.

We do not request or intentionally collect special-category personal data, and we
do not use tracking or advertising cookies — only a strictly necessary sign-in
cookie that keeps you logged in.

## Legal bases for processing

Where the GDPR applies, we process personal data on these legal bases:

- **Performance of a contract** — to create your account and provide the Service.
- **Legitimate interests** — to keep the Service secure, prevent abuse, and
  operate and improve it, balanced against your rights.
- **Legal obligation** — where we must retain or disclose data to comply with law.
- **Consent** — where we ask for it; you can withdraw consent at any time.

## How we use information

- Provide, maintain, and secure the Service.
- Authenticate users and enforce organization roles and permissions.
- Send transactional messages such as email verification, password resets, and
  invitations.
- Diagnose problems and improve the Service.

We do **not** sell your information or use your project data for advertising.

## How information is shared

- **Within your organization** — your projects are visible to members of your
  organization according to their assigned roles.
- **Service providers (subprocessors)** — we use a small number of trusted
  providers to help operate the Service (for example, hosting and email delivery),
  bound by data-processing agreements and used only to deliver the Service. The
  current list is published at [/subprocessors](/subprocessors).
- **Legal** — we may disclose information if required by law or to protect the
  rights, safety, or security of users and the Service.

## International data transfers

Your data may be processed in countries other than your own. Where personal data
is transferred outside the EEA or UK, we rely on appropriate safeguards — such as
the European Commission's Standard Contractual Clauses — to protect it.

## Data retention

We retain your data for as long as your account or organization is active, and as
needed to provide the Service. When a project, user, or organization is deleted,
the associated data and uploaded files are permanently removed. You can trigger
deletion yourself at any time (see "Your rights").

## Security

We use reasonable technical and organizational measures to protect your data,
including hashed credentials, encrypted-in-transit connections, per-organization
isolation, and access controls. No method of transmission or storage is completely
secure, but we work to protect your information and will notify affected users and
authorities of a personal-data breach as required by law.

## Your rights

Under the GDPR and similar laws you have the right to:

- **Access** the personal data we hold about you.
- **Rectify** inaccurate or incomplete data — you can edit your account details
  directly.
- **Erase** your data ("right to be forgotten") — admins can delete users, and
  deleting a project or the organization permanently removes its data and files.
- **Restrict** or **object** to certain processing.
- **Portability** — obtain a copy of your data in a portable format; projects can
  be exported as an archive from the app.
- **Withdraw consent** where processing is based on consent.

To exercise these rights, contact your organization's administrator or SiteLens
support. You also have the right to lodge a complaint with your local data-
protection supervisory authority.

## Children's privacy

The Service is intended for professional use and is not directed to children. We
do not knowingly collect information from children.

## Changes to this policy

We may update this Privacy Policy from time to time. If we make material changes,
we will update the date above and, where appropriate, provide notice.

## Contact

Questions about your data or this policy, or to exercise your rights? Contact your
organization's administrator or reach out to SiteLens support.
`;

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" lastUpdated="June 11, 2026" content={CONTENT} />;
}
