import { LegalPage } from '@/components/legal-page';

export const metadata = {
  description: 'How SiteLens handles your data.',
  title: 'Privacy Policy — SiteLens',
};

const CONTENT = `
This Privacy Policy explains what information SiteLens (the "Service") collects,
how we use it, and the choices you have. We aim to collect only what we need to
provide the Service.

## Information we collect

- **Account information** — your email address and the organization name you
  provide when signing up or accepting an invite.
- **Organization and project data** — projects, building grids, control points,
  survey points, drawings, and other content you or your teammates create or
  upload.
- **Usage information** — basic technical information needed to operate the
  Service securely and reliably, such as authentication events.

We do not request or intentionally collect sensitive personal information.

## How we use information

We use the information to:

- Provide, maintain, and secure the Service.
- Authenticate users and enforce organization roles and permissions.
- Send transactional messages such as email verification, password resets, and
  invitations.
- Diagnose problems and improve the Service.

We do **not** sell your information or use your project data for advertising.

## How information is shared

- **Within your organization** — your projects are visible to members of your
  organization according to their assigned roles.
- **Service providers** — we may use trusted providers to help operate the
  Service, bound by confidentiality and data-protection obligations, and only to
  the extent needed to deliver the Service.
- **Legal** — we may disclose information if required by law or to protect the
  rights, safety, or security of users and the Service.

## Data retention

We retain your data for as long as your account or organization is active, and as
needed to provide the Service. When a project, user, or organization is deleted,
the associated data is removed in the ordinary course of operation.

## Security

We use reasonable technical and organizational measures to protect your data,
including encrypted credentials and access controls. No method of transmission or
storage is completely secure, but we work to protect your information.

## Your choices and rights

- You can review and update your account details at any time.
- Organization administrators can manage users, change roles, and remove members.
- To request access to, correction of, or deletion of your data, contact your
  organization's administrator or SiteLens support.

## Children's privacy

The Service is intended for professional use and is not directed to children. We
do not knowingly collect information from children.

## Changes to this policy

We may update this Privacy Policy from time to time. If we make material changes,
we will update the date above and, where appropriate, provide notice.

## Contact

Questions about your data or this policy? Contact your organization's
administrator or reach out to SiteLens support.
`;

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" lastUpdated="June 11, 2026" content={CONTENT} />;
}
