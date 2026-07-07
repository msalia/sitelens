# SiteLens — Legal & GDPR compliance pack

> **These are working templates, not legal advice.** Every document here needs
> review by qualified counsel and the placeholders filled in before you rely on
> it. Search for `[TODO: …]` to find everything that must be completed.

| Document                                   | Purpose                                                      | GDPR basis               |
| ------------------------------------------ | ------------------------------------------------------------ | ------------------------ |
| [DPA.md](./DPA.md)                         | Data Processing Agreement offered to customers (controllers) | Art. 28                  |
| [SUBPROCESSORS.md](./SUBPROCESSORS.md)     | Source for the public `/subprocessors` page                  | Art. 28(2), 28(4), 44–49 |
| [BREACH_RESPONSE.md](./BREACH_RESPONSE.md) | Incident runbook + notification templates + register         | Art. 33–34               |
| [ROPA.md](./ROPA.md)                       | Records of processing (SiteLens as processor)                | Art. 30(2)               |

## Operator details (filled in)

- **Entity:** KeshavTech LLC
- **Registered address:** 510 Perrineville Road, Hightstown, NJ 08520, USA
- **Privacy/legal contact:** privacy@msalia.org
- **Security contact / incident lead:** Mukund Salia — security@msalia.org,
  (650) 334-5493
- **Data Protection Officer:** Mukund Salia — privacy@msalia.org
- **Hosting:** self-hosted on KeshavTech LLC's own infrastructure in the **United
  States** (on-premise) — there is **no third-party hosting sub-processor**.

- **Governing law (DPA):** State of New Jersey, USA. (The EU SCCs remain governed
  by an EU member-state law for EU transfers, and the UK IDTA by England & Wales.)

## Remaining decisions

- `[TODO: EU/UK REPRESENTATIVE]` — KeshavTech LLC is US-based; an Art. 27 representative
  is required **if** the Service is offered to data subjects in the EU/UK.

## How these connect to the app

- **Right to erasure** → project delete + org delete purge DB rows _and_ uploaded files.
- **Rectification** → users edit their own account; admins manage roles.
- **Portability** → projects export to a `.slx` archive.
- **Security (Art. 32)** → see `DPA.md` Annex II (hashed credentials, TLS, RBAC,
  per-org isolation, rate limiting).

Keep these documents updated whenever subprocessors, security measures, or
processing activities change.
