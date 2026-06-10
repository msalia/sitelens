//! Rate limiting for sensitive auth endpoints (login, signup), keyed by client
//! IP so a single source can't brute-force credentials or mass-create orgs.
//!
//! Two backends share one interface:
//! - `Memory` — an in-process sliding window. Zero deps; correct for a single
//!   API instance and used by tests.
//! - `Redis` — a fixed-window `INCR`+`EXPIRE` counter in a shared Redis, so the
//!   limit holds across multiple API instances. On any Redis error it **fails
//!   open** (allows the request) so a cache outage never locks users out.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The client's IP, injected into the GraphQL request context by the HTTP layer
/// (from `X-Forwarded-For`, since the API runs behind Traefik).
#[derive(Clone, Debug)]
pub struct ClientIp(pub String);

/// In-process sliding-window counter: at most `max` events per `window` per key.
pub struct MemoryLimiter {
    max: usize,
    window: Duration,
    hits: Mutex<HashMap<String, Vec<Instant>>>,
}

impl MemoryLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            hits: Mutex::new(HashMap::new()),
        }
    }

    /// Records an attempt for `key` and reports whether it is allowed. Returns
    /// `false` once `max` attempts have occurred within the trailing `window`.
    pub fn check(&self, key: &str, now: Instant) -> bool {
        let mut map = self.hits.lock().unwrap();
        let bucket = map.entry(key.to_string()).or_default();
        bucket.retain(|t| now.duration_since(*t) < self.window);
        if bucket.len() >= self.max {
            return false;
        }
        bucket.push(now);
        true
    }
}

/// The auth rate limiter, backed by an in-process window or shared Redis.
pub enum RateLimiter {
    Memory(MemoryLimiter),
    Redis {
        manager: redis::aio::ConnectionManager,
        max: u64,
        window_secs: u64,
    },
}

impl RateLimiter {
    /// An in-process limiter (single instance / tests).
    pub fn memory(max: usize, window: Duration) -> Self {
        RateLimiter::Memory(MemoryLimiter::new(max, window))
    }

    /// A Redis-backed limiter shared across API instances. Establishes a managed
    /// (auto-reconnecting) connection up front.
    pub async fn connect_redis(url: &str, max: u64, window_secs: u64) -> redis::RedisResult<Self> {
        let client = redis::Client::open(url)?;
        let manager = redis::aio::ConnectionManager::new(client).await?;
        Ok(RateLimiter::Redis {
            manager,
            max,
            window_secs,
        })
    }

    /// Records an attempt for `key` and reports whether it is allowed.
    pub async fn check(&self, key: &str) -> bool {
        match self {
            RateLimiter::Memory(m) => m.check(key, Instant::now()),
            RateLimiter::Redis {
                manager,
                max,
                window_secs,
            } => {
                let mut conn = manager.clone();
                let redis_key = format!("rl:{key}");
                // Fixed-window counter: INCR, and set the TTL on the first hit.
                let count: redis::RedisResult<u64> = redis::cmd("INCR")
                    .arg(&redis_key)
                    .query_async(&mut conn)
                    .await;
                match count {
                    Ok(c) => {
                        if c == 1 {
                            let _: redis::RedisResult<()> = redis::cmd("EXPIRE")
                                .arg(&redis_key)
                                .arg(*window_secs)
                                .query_async(&mut conn)
                                .await;
                        }
                        c <= *max
                    }
                    // Fail open: never lock users out because the cache is down.
                    Err(_) => true,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_up_to_max_then_blocks() {
        let rl = MemoryLimiter::new(3, Duration::from_secs(60));
        let t0 = Instant::now();
        assert!(rl.check("a", t0));
        assert!(rl.check("a", t0));
        assert!(rl.check("a", t0));
        assert!(!rl.check("a", t0), "4th attempt within window is blocked");
        // A different key has its own budget.
        assert!(rl.check("b", t0));
    }

    #[test]
    fn window_slides() {
        let rl = MemoryLimiter::new(1, Duration::from_secs(10));
        let t0 = Instant::now();
        assert!(rl.check("a", t0));
        assert!(!rl.check("a", t0));
        // After the window passes, the old hit is evicted and we're allowed again.
        assert!(rl.check("a", t0 + Duration::from_secs(11)));
    }
}
