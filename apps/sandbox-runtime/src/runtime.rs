use std::time::Duration;

use tokio::task::JoinSet;
use tokio::time::{interval_at, Instant, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub async fn run(shutdown: CancellationToken) {
    let mut roles = JoinSet::new();
    roles.spawn(run_role(shutdown.clone(), "supervisor"));
    roles.spawn(run_role(shutdown.clone(), "egress"));

    shutdown.cancelled().await;
    while roles.join_next().await.is_some() {}
}

async fn run_role(shutdown: CancellationToken, role: &'static str) {
    let mut ticker = interval_at(Instant::now() + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

    tracing::info!(role, "runtime role started");
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                tracing::info!(role, "runtime role stopping");
                return;
            }
            _ = ticker.tick() => {
                tracing::debug!(role, "runtime role heartbeat");
            }
        }
    }
}
