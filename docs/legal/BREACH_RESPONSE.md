# Personal Data Breach Response Runbook

> **TEMPLATE — REQUIRES REVIEW.** KeshavTech LLC's internal process for handling a
> personal data breach in SiteLens, per GDPR Art. 33–34. Fill every `[TODO: …]`.
> Last updated: June 11, 2026.

## Key facts

- **Owner / incident lead:** Mukund Salia — security@msalia.org, (650) 334-5493
- **Roles:** KeshavTech LLC is a **processor** for Customer project/account data, and a
  **controller** for its own account/identity data.
- **The 72-hour clock** starts when KeshavTech LLC (or the controller) becomes "aware"
  that a breach has likely occurred — not when the investigation finishes.

## Definitions

A **personal data breach** is a breach of security leading to accidental or
unlawful destruction, loss, alteration, unauthorized disclosure of, or access to,
personal data.

## Step 1 — Detect & report (any time)

Sources: server/application logs, error monitoring, [TODO: alerting], customer
reports, vendor (sub-processor) notifications. Anyone who suspects a breach reports
it immediately to the security contact. Record the date/time of awareness.

## Step 2 — Triage & contain (hours 0–24)

- Confirm whether a breach actually occurred.
- Contain: revoke sessions/tokens, rotate secrets, block access, isolate affected
  systems, deploy a fix.
- Preserve evidence (logs, snapshots) for the investigation.
- Open an entry in the **Breach Register** (below).

## Step 3 — Assess risk to individuals

Assess scope and severity: data types, volume, number of data subjects, whether
data was encrypted/pseudonymized, and likely consequences (identity theft, loss of
confidentiality, etc.). Classify:

- **No risk** → log internally; no external notification required.
- **Risk to individuals** → notify the supervisory authority (where KeshavTech LLC is
  controller) / the affected controller (where KeshavTech LLC is processor).
- **High risk** → also notify affected data subjects.

## Step 4 — Notify

- **As processor:** notify each affected **Customer (controller) without undue
  delay** so they can meet their own 72h obligation. Use Template A.
- **As controller (own account data):** notify the competent **supervisory
  authority within 72h** of awareness (Template B); if the 72h is missed, include
  reasons for the delay.
- **High risk to individuals:** notify affected **data subjects without undue
  delay** (Template C).
- If full details aren't ready in time, notify in phases.

## Step 5 — Record & remediate

- Complete the Breach Register entry (facts, effects, remedial actions) — required
  even for non-notifiable breaches (Art. 33(5)).
- Implement preventive actions; capture lessons learned.

---

## Template A — Notice to Customer (controller)

> Subject: Security incident affecting your SiteLens data
>
> We are notifying you of a personal data breach that may affect your
> organization's data in SiteLens.
>
> - **What happened / when discovered:** [TODO]
> - **Nature of the breach & data involved:** [TODO]
> - **Likely consequences:** [TODO]
> - **Measures taken / proposed:** [TODO]
> - **Contact for more information:** privacy@msalia.org
>
> We will provide updates as our investigation continues.

## Template B — Notice to supervisory authority (Art. 33(3))

Include: nature of the breach (categories & approximate number of data subjects and
records); name/contact of the DPO or contact point; likely consequences; measures
taken or proposed. [TODO: identify the competent supervisory authority.]

## Template C — Notice to data subjects (Art. 34(2))

Plain-language description of the breach; name/contact point; likely consequences;
measures taken/proposed; recommended steps individuals can take (e.g. reset
password, watch for phishing).

---

## Breach Register

| ID        | Date aware | Description | Data & subjects affected | Risk level       | Notified (who / when) | Remedial actions | Status        |
| --------- | ---------- | ----------- | ------------------------ | ---------------- | --------------------- | ---------------- | ------------- |
| _example_ | _2026-..._ | _..._       | _..._                    | _none/risk/high_ | _..._                 | _..._            | _open/closed_ |
