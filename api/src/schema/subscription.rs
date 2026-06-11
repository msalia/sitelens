#![allow(clippy::too_many_arguments)]
use async_graphql::futures_util::Stream;
use async_graphql::Subscription;
use tokio::sync::broadcast::error::RecvError;

use super::*;
use crate::pubsub::ScenePubSub;

#[derive(Default)]
pub struct SubscriptionRoot;

#[Subscription]
impl SubscriptionRoot {
    /// Emits a ping (the project id) each time the project's scene changes —
    /// points, control points, grid, overlays, terrain/buildings, transform, or
    /// georeference. The payload is intentionally minimal; clients refetch the
    /// scene on the ping. Authenticated via the session cookie sent on the
    /// WebSocket upgrade; only members of the project's organization may subscribe.
    async fn project_changed(
        &self,
        ctx: &Context<'_>,
        project_id: Uuid,
    ) -> Result<impl Stream<Item = Uuid>> {
        let auth = require_auth(ctx)?;
        let owned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)",
        )
        .bind(project_id)
        .bind(auth.org_id)
        .fetch_one(pool(ctx)?)
        .await?;
        if !owned {
            return Err(async_graphql::Error::new(
                "project not found in your organization",
            ));
        }
        let mut rx = ctx.data::<ScenePubSub>()?.subscribe(project_id);
        Ok(async_stream::stream! {
            // Yield on every change. A lag (slow subscriber) still warrants one
            // ping since the client refetches; only a closed channel ends the
            // stream (the `while let` exits when the pattern stops matching).
            while let Ok(()) | Err(RecvError::Lagged(_)) = rx.recv().await {
                yield project_id;
            }
        })
    }
}
