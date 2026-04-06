//! Coarse keepalive state for `sandboxd`.
//!
//! Gateway idleness only needs one sandbox-level answer: is there still any
//! user or platform activity that should keep this sandbox alive? This module
//! owns that coarse state, the fixed tunnel TTL/heartbeat policy, and the
//! decision about when a fresh `keepalive.state` payload must be published.

use std::time::Duration;

use crate::protocol::keepalive::{KeepaliveMessageType, KeepaliveState};
use crate::time::Clock;

/// Fixed TTL for one published `keepalive.state`.
pub const KEEPALIVE_TTL_MS: u64 = 30_000;
/// Fixed heartbeat interval while the tunnel is connected.
pub const KEEPALIVE_HEARTBEAT_INTERVAL: Duration = Duration::from_millis(10_000);

/// Tracks sandbox-level user/platform activity and publication state.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct KeepaliveManager {
    has_user_activity: bool,
    has_platform_activity: bool,
    tunnel_connected: bool,
    last_published_active: Option<bool>,
    next_heartbeat_at_ms: Option<u64>,
}

impl KeepaliveManager {
    /// Marks the bootstrap tunnel as connected and schedules an immediate publish.
    pub fn on_tunnel_connected(&mut self, clock: &dyn Clock) {
        self.tunnel_connected = true;
        self.last_published_active = None;
        self.next_heartbeat_at_ms = Some(clock.now_ms());
    }

    /// Marks the bootstrap tunnel as disconnected and suppresses heartbeat output.
    pub fn on_tunnel_disconnected(&mut self) {
        self.tunnel_connected = false;
        self.next_heartbeat_at_ms = None;
    }

    /// Sets the coarse user-activity bit derived from user process scopes.
    pub fn set_user_active(&mut self, active: bool) {
        self.has_user_activity = active;
    }

    /// Sets the coarse platform-activity bit derived from runtime adapters.
    pub fn set_platform_active(&mut self, active: bool) {
        self.has_platform_activity = active;
    }

    /// Returns whether any current activity should keep the sandbox alive.
    pub fn active(&self) -> bool {
        self.has_user_activity || self.has_platform_activity
    }

    /// Builds the current wire payload without mutating publication state.
    pub fn snapshot(&self) -> KeepaliveState {
        KeepaliveState {
            message_type: KeepaliveMessageType::State,
            ttl_ms: KEEPALIVE_TTL_MS,
            active: self.active(),
        }
    }

    /// Returns the next `keepalive.state` payload when a connect, state change,
    /// or heartbeat requires one.
    pub fn take_publishable_state(&mut self, clock: &dyn Clock) -> Option<KeepaliveState> {
        if !self.tunnel_connected {
            return None;
        }

        let now_ms = clock.now_ms();
        let active = self.active();
        let should_publish = self.last_published_active != Some(active)
            || self
                .next_heartbeat_at_ms
                .is_some_and(|deadline| now_ms >= deadline);
        if !should_publish {
            return None;
        }

        self.last_published_active = Some(active);
        self.next_heartbeat_at_ms = Some(
            now_ms.saturating_add(
                KEEPALIVE_HEARTBEAT_INTERVAL
                    .as_millis()
                    .try_into()
                    .expect("heartbeat interval milliseconds should fit in u64"),
            ),
        );
        Some(self.snapshot())
    }
}

#[cfg(test)]
mod tests {
    use crate::keepalive::{KEEPALIVE_HEARTBEAT_INTERVAL, KEEPALIVE_TTL_MS, KeepaliveManager};
    use crate::protocol::keepalive::KeepaliveMessageType;
    use crate::time::testing::MutableClock;

    #[test]
    fn publishes_immediately_when_tunnel_connects() {
        let clock = MutableClock::new(1_000);
        let mut manager = KeepaliveManager::default();

        manager.on_tunnel_connected(&clock);

        let state = manager
            .take_publishable_state(&clock)
            .expect("tunnel connect should trigger an immediate publish");
        assert_eq!(state.message_type, KeepaliveMessageType::State);
        assert_eq!(state.ttl_ms, KEEPALIVE_TTL_MS);
        assert!(!state.active);
    }

    #[test]
    fn publishes_again_when_activity_changes() {
        let clock = MutableClock::new(1_000);
        let mut manager = KeepaliveManager::default();
        manager.on_tunnel_connected(&clock);
        let _ = manager.take_publishable_state(&clock);

        manager.set_user_active(true);

        let state = manager
            .take_publishable_state(&clock)
            .expect("activity change should trigger a publish");
        assert!(state.active);
    }

    #[test]
    fn publishes_heartbeat_after_fixed_interval() {
        let clock = MutableClock::new(1_000);
        let mut manager = KeepaliveManager::default();
        manager.on_tunnel_connected(&clock);
        let _ = manager.take_publishable_state(&clock);

        clock.advance_ms(
            KEEPALIVE_HEARTBEAT_INTERVAL
                .as_millis()
                .try_into()
                .expect("heartbeat interval milliseconds should fit in u64"),
        );

        let state = manager
            .take_publishable_state(&clock)
            .expect("heartbeat interval should trigger another publish");
        assert!(!state.active);
    }

    #[test]
    fn does_not_publish_while_disconnected() {
        let clock = MutableClock::new(1_000);
        let mut manager = KeepaliveManager::default();
        manager.on_tunnel_connected(&clock);
        let _ = manager.take_publishable_state(&clock);
        manager.on_tunnel_disconnected();

        manager.set_platform_active(true);

        assert!(
            manager.take_publishable_state(&clock).is_none(),
            "disconnected tunnels should not publish keepalive state"
        );
    }
}
