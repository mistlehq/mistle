//! Shared time abstractions for `sandboxd`.
//!
//! Keep time-dependent behavior injectable so subsystems can swap real waiting
//! for deterministic test implementations without touching global timer APIs.

use std::time::Duration;

/// Suspends execution for a requested duration.
pub trait Sleeper: Send + Sync {
    fn sleep(&self, duration: Duration);
}

/// Production sleeper that delegates to `std::thread::sleep`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ThreadSleeper;

impl Sleeper for ThreadSleeper {
    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

#[cfg(test)]
pub mod testing {
    //! Deterministic test implementations for `sandboxd::time`.

    use std::sync::{Arc, Condvar, Mutex};
    use std::time::Duration;

    use crate::time::Sleeper;

    /// Test sleeper that records requested durations without blocking on real time.
    #[derive(Debug, Clone, Default)]
    pub struct ManualSleeper {
        state: Arc<ManualSleeperState>,
    }

    #[derive(Debug, Default)]
    struct ManualSleeperState {
        requested_durations: Mutex<Vec<Duration>>,
        requested_durations_changed: Condvar,
    }

    impl ManualSleeper {
        /// Returns the durations this sleeper has been asked to wait for.
        pub fn requested_durations(&self) -> Vec<Duration> {
            self.state
                .requested_durations
                .lock()
                .expect("manual sleeper lock should not be poisoned")
                .clone()
        }

        /// Waits until at least `count` sleep requests have been recorded or the timeout expires.
        pub fn wait_for_sleep_requests(&self, count: usize, timeout: Duration) -> bool {
            let requested_durations = self
                .state
                .requested_durations
                .lock()
                .expect("manual sleeper lock should not be poisoned");
            let wait_result = self
                .state
                .requested_durations_changed
                .wait_timeout_while(requested_durations, timeout, |requested_durations| {
                    requested_durations.len() < count
                })
                .expect("manual sleeper condvar should not be poisoned");

            wait_result.0.len() >= count
        }
    }

    impl Sleeper for ManualSleeper {
        fn sleep(&self, duration: Duration) {
            self.state
                .requested_durations
                .lock()
                .expect("manual sleeper lock should not be poisoned")
                .push(duration);
            self.state.requested_durations_changed.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crate::time::testing::ManualSleeper;
    use crate::time::{Sleeper, ThreadSleeper};

    #[test]
    fn manual_sleeper_records_requested_durations() {
        let sleeper = ManualSleeper::default();

        sleeper.sleep(Duration::from_millis(5));
        sleeper.sleep(Duration::from_millis(9));

        assert_eq!(
            sleeper.requested_durations(),
            vec![Duration::from_millis(5), Duration::from_millis(9)]
        );
    }

    #[test]
    fn thread_sleeper_implements_sleeper_trait() {
        let sleeper = ThreadSleeper;

        sleeper.sleep(Duration::from_millis(0));
    }
}
