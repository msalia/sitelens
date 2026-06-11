//! Transactional email via Resend.
//!
//! The app reads a **send-only-scoped** `RESEND_API_KEY` from env (the SiteLens
//! convention, like `JWT_SECRET`). When the key is unset (local dev), the mailer
//! logs the message + link to stdout instead of sending, so auth flows still work
//! end-to-end without a provider. The full-access devkit key is never used here.

use resend_rs::types::CreateEmailBaseOptions;
use resend_rs::Resend;

/// Sends transactional email, or logs to stdout when no API key is configured.
pub struct Mailer {
    /// `None` → log mode (no `RESEND_API_KEY`).
    client: Option<Resend>,
    /// Verified sender, e.g. `SiteLens <noreply@msalia.org>`.
    from: String,
    /// Web-app base URL for building links, e.g. `https://sitelens.msalia.org`.
    app_url: String,
}

impl Mailer {
    /// Builds the mailer from env: `RESEND_API_KEY` (send-only), `SITELENS_MAIL_FROM`,
    /// and `APP_URL`. With no key, runs in log mode.
    pub fn from_env() -> Self {
        let from = std::env::var("SITELENS_MAIL_FROM")
            .unwrap_or_else(|_| "SiteLens <noreply@msalia.org>".to_string());
        let app_url =
            std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());
        let client = std::env::var("RESEND_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
            .map(|k| Resend::new(&k));
        if client.is_none() {
            eprintln!(
                "mail: RESEND_API_KEY unset — running in log mode (emails printed, not sent)"
            );
        }
        Self {
            client,
            from,
            app_url,
        }
    }

    /// Web-app URL base (no trailing slash) for building links in resolvers.
    pub fn app_url(&self) -> &str {
        self.app_url.trim_end_matches('/')
    }

    async fn deliver(&self, to: &str, subject: &str, html: &str, text: &str) -> Result<(), String> {
        match &self.client {
            // Log mode: surface the message + link so dev flows work with no key.
            None => {
                println!("[mail:log] to={to} subject={subject:?}\n{text}");
                Ok(())
            }
            Some(client) => {
                let email = CreateEmailBaseOptions::new(self.from.clone(), [to], subject)
                    .with_html(html)
                    .with_text(text);
                client
                    .emails
                    .send(email)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
        }
    }

    pub async fn send_verification(&self, to: &str, link: &str) -> Result<(), String> {
        let (subject, html, text) = verification_email(link);
        self.deliver(to, &subject, &html, &text).await
    }

    pub async fn send_password_reset(&self, to: &str, link: &str) -> Result<(), String> {
        let (subject, html, text) = password_reset_email(link);
        self.deliver(to, &subject, &html, &text).await
    }

    pub async fn send_invite(&self, to: &str, org_name: &str, link: &str) -> Result<(), String> {
        let (subject, html, text) = invite_email(org_name, link);
        self.deliver(to, &subject, &html, &text).await
    }
}

// --- Body builders (pure; unit-tested) -------------------------------------

fn layout(heading: &str, body_html: &str) -> String {
    format!(
        "<div style=\"font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#1f2937\">\
         <h1 style=\"font-size:18px\">{heading}</h1>{body_html}\
         <p style=\"color:#6b7280;font-size:12px;margin-top:24px\">SiteLens — survey coordinate tooling</p></div>"
    )
}

fn button(href: &str, label: &str) -> String {
    format!(
        "<p><a href=\"{href}\" style=\"display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none\">{label}</a></p>\
         <p style=\"color:#6b7280;font-size:12px\">Or paste this link into your browser:<br>{href}</p>"
    )
}

fn verification_email(link: &str) -> (String, String, String) {
    let subject = "Verify your SiteLens email".to_string();
    let html = layout(
        "Verify your email",
        &format!(
            "<p>Confirm your email to finish setting up your SiteLens account.</p>{}",
            button(link, "Verify email")
        ),
    );
    let text = format!("Verify your SiteLens email:\n{link}\n");
    (subject, html, text)
}

fn password_reset_email(link: &str) -> (String, String, String) {
    let subject = "Reset your SiteLens password".to_string();
    let html = layout(
        "Reset your password",
        &format!(
            "<p>We received a request to reset your password. This link expires in 1 hour and can be used once.</p>{}\
             <p style=\"color:#6b7280;font-size:12px\">If you didn't request this, you can safely ignore this email.</p>",
            button(link, "Reset password")
        ),
    );
    let text =
        format!("Reset your SiteLens password (expires in 1 hour, single use):\n{link}\n\nIf you didn't request this, ignore this email.\n");
    (subject, html, text)
}

fn invite_email(org_name: &str, link: &str) -> (String, String, String) {
    let subject = format!("You're invited to {org_name} on SiteLens");
    let html = layout(
        "You've been invited",
        &format!(
            "<p>You've been invited to join <strong>{org_name}</strong> on SiteLens.</p>{}",
            button(link, "Accept invite")
        ),
    );
    let text = format!("You've been invited to join {org_name} on SiteLens:\n{link}\n");
    (subject, html, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bodies_include_the_link_and_subject() {
        let (s, h, t) = verification_email("https://app/verify?token=abc");
        assert!(s.contains("Verify"));
        assert!(h.contains("https://app/verify?token=abc"));
        assert!(t.contains("https://app/verify?token=abc"));

        let (s, h, t) = password_reset_email("https://app/reset?token=def");
        assert!(s.to_lowercase().contains("reset"));
        assert!(h.contains("def") && t.contains("def"));

        let (s, _h, t) = invite_email("Helix Surveying", "https://app/accept?token=ghi");
        assert!(s.contains("Helix Surveying"));
        assert!(t.contains("ghi"));
    }

    #[tokio::test]
    async fn log_mode_when_no_key_does_not_send_or_panic() {
        // No RESEND_API_KEY → client None → deliver logs and returns Ok.
        let mailer = Mailer {
            client: None,
            from: "SiteLens <noreply@example.com>".to_string(),
            app_url: "http://localhost:3000/".to_string(),
        };
        mailer
            .send_verification("u@example.com", "https://app/verify?token=z")
            .await
            .unwrap();
        // Trailing slash trimmed for link-building.
        assert_eq!(mailer.app_url(), "http://localhost:3000");
    }

    /// Real network send through resend-rs (skipped by default). Run with:
    ///   RESEND_API_KEY=… SITELENS_MAIL_FROM='SiteLens <noreply@msalia.org>' \
    ///   cargo test --manifest-path api/Cargo.toml --lib -- --ignored real_send_smoke
    #[tokio::test]
    #[ignore = "real network send; needs RESEND_API_KEY"]
    async fn real_send_smoke() {
        Mailer::from_env()
            .send_verification(
                "delivered@resend.dev",
                "https://sitelens.msalia.org/verify?token=smoke",
            )
            .await
            .expect("resend send should succeed");
    }
}
