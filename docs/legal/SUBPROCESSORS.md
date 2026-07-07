# Sub-processors

> Source for the public **/subprocessors** page. KeshavTech LLC (operator of SiteLens)
> uses the third parties below to process Customer Personal Data. Keep this list
> current; give customers ≥30 days' notice before adding or replacing a
> sub-processor so they can object (see [DPA.md](./DPA.md) §5).
> Last updated: June 11, 2026.

| Sub-processor | Purpose                                                                  | Data processed                            | Location      | Transfer safeguard                                                                                                            |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Resend**    | Transactional email delivery (verification, password reset, invitations) | Recipient email address + message content | United States | DPA + EU SCCs (Module 3, processor→processor); UK IDTA where applicable. ✅ Signed DPA/SCCs on file (`resend-dpa-signed.pdf`) |
| **Stripe**    | Subscription billing and payment processing                              | Billing admin email + payment details (held by Stripe) | United States | DPA + EU SCCs (Module 3, processor→processor); UK IDTA where applicable. [TODO: confirm Stripe DPA acceptance on file]        |

## Hosting

SiteLens is **self-hosted on KeshavTech LLC's own infrastructure in the United States**
(on-premise). There is **no third-party hosting provider** with access to Customer
data, so hosting is not a sub-processor. Because data is processed in the US,
transfers from the EEA/UK rely on the EU SCCs / UK IDTA (see the DPA).

## Not sub-processors of personal data

- **Map / terrain / building data sources** receive only derived bounding-box
  coordinates for a project's area. **No personal data** is sent to them, so they
  are not sub-processors under this DPA.

## Change notification

KeshavTech LLC will notify customers of new or replaced sub-processors with at least
**30 days' notice** via the Service or email to organization admins. A customer
may object on reasonable data-protection grounds within that window.

## To do before publishing

- [x] Sign and file the Resend DPA/SCCs — see `resend-dpa-signed.pdf`.
- [TODO: complete a Transfer Impact Assessment for US processing (KeshavTech LLC is
  US-based) and the Resend transfer]
