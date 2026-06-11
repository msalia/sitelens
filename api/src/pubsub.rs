//! In-process pub/sub for live scene updates.
//!
//! Each project gets a `tokio::sync::broadcast` channel. Scene-affecting
//! mutations call [`ScenePubSub::publish`]; a GraphQL subscription holds a
//! [`ScenePubSub::subscribe`] receiver and forwards a ping to the client on every
//! change. The payload is intentionally empty — clients refetch on the ping. This
//! is per-process (fine for a single API instance); a Redis fan-out would be the
//! seam if the API is ever scaled horizontally.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::broadcast;
use uuid::Uuid;

/// Per-project broadcast hub. Cloneable; clones share the same channels.
#[derive(Clone, Default)]
pub struct ScenePubSub {
    channels: Arc<Mutex<HashMap<Uuid, broadcast::Sender<()>>>>,
}

impl ScenePubSub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Notifies subscribers that the project's scene changed. No-op if nobody is
    /// listening.
    pub fn publish(&self, project_id: Uuid) {
        let channels = self.channels.lock().expect("pubsub lock");
        if let Some(tx) = channels.get(&project_id) {
            // Err only means there are no receivers right now — safe to ignore.
            let _ = tx.send(());
        }
    }

    /// Returns a receiver that yields once per published change for the project,
    /// creating the channel on first use.
    pub fn subscribe(&self, project_id: Uuid) -> broadcast::Receiver<()> {
        let mut channels = self.channels.lock().expect("pubsub lock");
        channels
            .entry(project_id)
            .or_insert_with(|| broadcast::channel(16).0)
            .subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn publish_reaches_subscriber_of_same_project_only() {
        let hub = ScenePubSub::new();
        let p1 = Uuid::new_v4();
        let p2 = Uuid::new_v4();

        let mut rx1 = hub.subscribe(p1);
        let mut rx2 = hub.subscribe(p2);

        hub.publish(p1);

        // p1's subscriber gets the ping.
        assert!(rx1.try_recv().is_ok());
        // p2's subscriber gets nothing.
        assert!(rx2.try_recv().is_err());
    }

    #[test]
    fn publish_with_no_subscribers_is_a_noop() {
        let hub = ScenePubSub::new();
        hub.publish(Uuid::new_v4()); // must not panic
    }
}
