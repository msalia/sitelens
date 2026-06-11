import { LegalPage } from '@/components/legal-page';

export const metadata = {
  description: 'The terms that govern your use of SiteLens.',
  title: 'Terms of Service — SiteLens',
};

const CONTENT = `
Welcome to SiteLens. These Terms of Service ("Terms") govern your access to and
use of SiteLens (the "Service"). By creating an account or using the Service, you
agree to these Terms. If you are using the Service on behalf of an organization,
you agree to these Terms for that organization.

## 1. The Service

SiteLens is a tool for construction surveyors to tie a building grid to
real-world control, and to import, convert, visualize, and export survey
coordinates. The Service is provided to help you work with coordinate data; it
does not replace professional judgment.

## 2. Accounts and organizations

- You must provide accurate account information and keep it up to date.
- You are responsible for safeguarding your credentials and for all activity
  under your account.
- An organization's administrator controls who may access the organization's
  projects and what role each user has. You agree to use only the access granted
  to you.

## 3. Acceptable use

You agree not to:

- Use the Service unlawfully or in violation of any third party's rights.
- Attempt to gain unauthorized access to the Service, other accounts, or
  organizations' data.
- Interfere with or disrupt the integrity or performance of the Service.
- Upload content you do not have the right to upload.

## 4. Your data

You retain all rights to the data and content you upload ("Your Data"). You grant
us the limited rights needed to host, process, and display Your Data solely to
provide the Service to you and your organization. We do not sell Your Data.

## 5. Accuracy and professional responsibility

SiteLens assists with coordinate computation and visualization, but **you are
responsible for verifying all results** against your source data and professional
standards. Terrain and contextual map features are provided for visual context
only and are **not survey-grade**. The elevations and coordinates you enter remain
the source of truth. Do not rely on the Service as the sole basis for any
construction, legal, or safety decision.

## 6. Availability and changes

We may update, improve, or change the Service over time. We may also suspend or
discontinue features. We will make reasonable efforts to avoid disruption but do
not guarantee uninterrupted availability.

## 7. Termination

You may stop using the Service at any time. We may suspend or terminate access if
you violate these Terms or use the Service in a way that risks harm to others or
to the Service.

## 8. Disclaimer of warranties

The Service is provided "as is" and "as available," without warranties of any
kind, whether express or implied, including fitness for a particular purpose and
non-infringement, to the fullest extent permitted by law.

## 9. Limitation of liability

To the fullest extent permitted by law, SiteLens and its operators will not be
liable for any indirect, incidental, special, consequential, or punitive damages,
or for any loss of data, profits, or business, arising out of or related to your
use of the Service.

## 10. Changes to these Terms

We may revise these Terms from time to time. If we make material changes, we will
update the date above and, where appropriate, provide notice. Your continued use
of the Service after changes take effect constitutes acceptance.

## 11. Contact

Questions about these Terms? Contact your organization's administrator or reach
out to SiteLens support.
`;

export default function TermsPage() {
  return <LegalPage title="Terms of Service" lastUpdated="June 11, 2026" content={CONTENT} />;
}
