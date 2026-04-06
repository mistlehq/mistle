//! Shared time abstractions for `sandboxd`.
//!
//! Keep time-dependent behavior injectable so subsystems can swap real waiting
//! for deterministic test implementations without touching global timer APIs.

use std::time::Duration;

/// Provides access to the current time as epoch milliseconds.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

/// Production clock that reads the current system wall clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_millis()
            .try_into()
            .expect("system clock epoch milliseconds should fit in u64")
    }
}

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

    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::Duration;

    use crate::time::{Clock, Sleeper};

    /// Test clock that callers can advance manually.
    #[derive(Debug, Clone)]
    pub struct MutableClock {
        now_ms: Arc<AtomicU64>,
    }

    impl MutableClock {
        /// Creates a mutable clock pinned to the provided initial epoch milliseconds.
        pub fn new(initial_now_ms: u64) -> Self {
            Self {
                now_ms: Arc::new(AtomicU64::new(initial_now_ms)),
            }
        }

        /// Advances the clock by the provided duration in milliseconds.
        pub fn advance_ms(&self, duration_ms: u64) {
            self.now_ms.fetch_add(duration_ms, Ordering::Relaxed);
        }
    }

    impl Clock for MutableClock {
        fn now_ms(&self) -> u64 {
            self.now_ms.load(Ordering::Relaxed)
        }
    }

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

    use crate::time::testing::{ManualSleeper, MutableClock};
    use crate::time::{Clock, Sleeper, SystemClock, ThreadSleeper};

    #[test]
    fn mutable_clock_advances_time() {
        let clock = MutableClock::new(100);

        clock.advance_ms(25);

        assert_eq!(clock.now_ms(), 125);
    }

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

    #[test]
    fn system_clock_reads_epoch_milliseconds() {
        let clock = SystemClock;

        assert!(clock.now_ms() > 0);
    }
}
