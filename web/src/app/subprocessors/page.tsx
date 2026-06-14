import { LegalPage } from '@/components/legal-page';

export const metadata = {
  alternates: { canonical: '/subprocessors' },
  description: 'Third parties KeshavTech uses to operate SiteLens.',
  title: 'Sub-processors',
};

const CONTENT = `
KeshavTech, the operator of SiteLens, uses a small number of trusted third parties
("sub-processors") to help deliver the Service. Each is bound by a data-processing
agreement and used only to provide the Service. We give customers at least 30 days'
notice before adding or replacing a sub-processor so they can object on reasonable
data-protection grounds.

## Current sub-processors

| Sub-processor | Purpose | Location | Transfer safeguard |
| --- | --- | --- | --- |
| Resend | Transactional email (verification, password reset, invitations) | United States | DPA + EU Standard Contractual Clauses |
| Stripe | Subscription billing and payment processing | United States | DPA + EU Standard Contractual Clauses |

## Hosting

SiteLens is self-hosted on KeshavTech's own infrastructure in the United States.
No third-party hosting provider has access to your data.

## What is **not** shared

Map, terrain, and building-context data sources receive only the coordinates of a
project's area — never personal data — so they are not sub-processors.

## Notifications

We notify organization administrators of new or replaced sub-processors via the app
or email. Questions? Contact your organization's administrator or SiteLens support.
`;

export default function SubprocessorsPage() {
  return <LegalPage title="Sub-processors" lastUpdated="June 11, 2026" content={CONTENT} />;
}
