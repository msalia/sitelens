#![allow(clippy::too_many_arguments)]
use super::*;

/// A captured email surfaced by `sentEmails` in `MAIL_CAPTURE` mode (test/e2e).
#[derive(async_graphql::SimpleObject)]
pub struct SentEmail {
    pub to: String,
    pub subject: String,
    /// Plain-text body — carries any verification/reset/invite link.
    pub text: String,
}

#[derive(Default)]
pub struct SystemQuery;

#[Object]
impl SystemQuery {
    /// Liveness check.
    async fn health(&self) -> &str {
        "ok"
    }

    /// Database connectivity check.
    async fn db_status(&self, ctx: &Context<'_>) -> String {
        match sqlx::query("SELECT 1").execute(pool(ctx).unwrap()).await {
            Ok(_) => "connected".to_string(),
            Err(_) => "disconnected".to_string(),
        }
    }

    /// Whether the server is in `MAIL_CAPTURE` mode (test/e2e). Lets clients skip
    /// mail-dependent flows when capture isn't available.
    async fn mail_capture_enabled(&self, ctx: &Context<'_>) -> Result<bool> {
        Ok(mailer(ctx)?.capture_enabled())
    }

    /// Test-only: emails captured while `MAIL_CAPTURE` is enabled (newest first),
    /// optionally filtered by recipient substring. Always empty in normal/prod
    /// operation, so no message contents are ever exposed there. Lets e2e assert
    /// the mail path ran and extract links without spending email quota.
    async fn sent_emails(&self, ctx: &Context<'_>, to: Option<String>) -> Result<Vec<SentEmail>> {
        let mailer = mailer(ctx)?;
        Ok(mailer
            .captured(to.as_deref())
            .into_iter()
            .map(|e| SentEmail {
                to: e.to,
                subject: e.subject,
                text: e.text,
            })
            .collect())
    }
}
