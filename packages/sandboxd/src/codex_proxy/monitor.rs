//! Active-thread projection for the raw Codex app-server monitor connection.
//!
//! The monitor follows Codex thread status notifications and reduces them to
//! the small keepalive signal that `sandboxd` needs: whether any Codex thread is
//! still active after client disconnects.

use std::collections::BTreeSet;

use crate::codex_proxy::message::CodexThreadStatus;
use crate::keepalive::KeepaliveManager;

/// Tracks the set of Codex threads whose current `thread.status` is `active`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CodexMonitor {
    active_threads: BTreeSet<String>,
}

impl CodexMonitor {
    /// Returns whether any currently known thread is still active.
    pub fn has_active_threads(&self) -> bool {
        !self.active_threads.is_empty()
    }

    /// Returns the active thread ids in sorted order.
    pub fn active_thread_ids(&self) -> Vec<String> {
        self.active_threads.iter().cloned().collect()
    }

    /// Applies one thread status change and updates coarse platform keepalive.
    pub fn apply_thread_status(
        &mut self,
        thread_id: &str,
        status: &CodexThreadStatus,
        keepalive_manager: &mut KeepaliveManager,
    ) {
        if status.is_active() {
            self.active_threads.insert(thread_id.to_string());
        } else {
            self.active_threads.remove(thread_id);
        }

        keepalive_manager.set_platform_active(self.has_active_threads());
    }

    /// Rebuilds thread activity from one full `thread/loaded/list` + `thread/read` snapshot.
    pub fn rebuild_from_threads(
        &mut self,
        threads: impl IntoIterator<Item = (String, CodexThreadStatus)>,
        keepalive_manager: &mut KeepaliveManager,
    ) {
        self.active_threads.clear();
        for (thread_id, status) in threads {
            if status.is_active() {
                self.active_threads.insert(thread_id);
            }
        }

        keepalive_manager.set_platform_active(self.has_active_threads());
    }

    /// Clears all local thread state after the monitor connection becomes stale.
    pub fn clear(&mut self, keepalive_manager: &mut KeepaliveManager) {
        self.active_threads.clear();
        keepalive_manager.set_platform_active(false);
    }
}

#[cfg(test)]
mod tests {
    use crate::codex_proxy::{CodexMonitor, CodexThreadStatus};
    use crate::keepalive::KeepaliveManager;

    #[test]
    fn rebuild_sets_platform_activity_from_active_threads() {
        let mut monitor = CodexMonitor::default();
        let mut keepalive_manager = KeepaliveManager::default();

        monitor.rebuild_from_threads(
            [
                (
                    "thr_active".to_string(),
                    CodexThreadStatus::Active {
                        active_flags: Vec::new(),
                    },
                ),
                ("thr_idle".to_string(), CodexThreadStatus::Idle),
            ],
            &mut keepalive_manager,
        );

        assert_eq!(monitor.active_thread_ids(), vec!["thr_active".to_string()]);
        assert!(keepalive_manager.active());
    }
}
