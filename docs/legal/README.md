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

## Placeholders to fill everywhere

The operating entity is **KeshavTech** (already filled in). Remaining placeholders:

- `[TODO: ENTITY ADDRESS]` — KeshavTech's registered address
- `[TODO: CONTACT EMAIL]` — privacy/legal contact (e.g. `privacy@…`)
- `[TODO: SECURITY CONTACT]` — where breaches are reported/handled
- `[TODO: HOSTING PROVIDER + REGION]`
- `[TODO: GOVERNING LAW]` — jurisdiction for the DPA
- `[TODO: EU/UK REPRESENTATIVE]` — only if KeshavTech is not established in the EU/UK (Art. 27)
- `[TODO: DPO]` — only if a DPO has been appointed (Art. 37)

## How these connect to the app

- **Right to erasure** → project delete + org delete purge DB rows _and_ uploaded files.
- **Rectification** → users edit their own account; admins manage roles.
- **Portability** → projects export to a `.slx` archive.
- **Security (Art. 32)** → see `DPA.md` Annex II (hashed credentials, TLS, RBAC,
  per-org isolation, rate limiting).

Keep these documents updated whenever subprocessors, security measures, or
processing activities change.
