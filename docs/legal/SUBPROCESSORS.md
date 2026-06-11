# Sub-processors

> Source for the public **/subprocessors** page. KeshavTech (operator of SiteLens)
> uses the third parties below to process Customer Personal Data. Keep this list
> current; give customers ≥30 days' notice before adding or replacing a
> sub-processor so they can object (see [DPA.md](./DPA.md) §5).
> Last updated: June 11, 2026.

| Sub-processor                | Purpose                                                                  | Data processed                            | Location       | Transfer safeguard                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| **Resend**                   | Transactional email delivery (verification, password reset, invitations) | Recipient email address + message content | United States  | DPA + EU SCCs (Module 3, processor→processor); UK IDTA where applicable. [TODO: confirm signed DPA on file] |
| **[TODO: HOSTING PROVIDER]** | Application + database hosting and file storage                          | All Customer data at rest                 | [TODO: REGION] | [TODO: provider DPA + SCCs/adequacy]                                                                        |

## Not sub-processors of personal data

- **Map / terrain / building data sources** receive only derived bounding-box
  coordinates for a project's area. **No personal data** is sent to them, so they
  are not sub-processors under this DPA.

## Change notification

KeshavTech will notify customers of new or replaced sub-processors with at least
**30 days' notice** via the Service or email to organization admins. A customer
may object on reasonable data-protection grounds within that window.

## To do before publishing

- [TODO: confirm and name the hosting/storage provider + region]
- [TODO: sign and file each sub-processor's DPA/SCCs]
- [TODO: complete a Transfer Impact Assessment for US transfers (Resend)]
