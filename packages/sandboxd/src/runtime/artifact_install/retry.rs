use std::fs::File;
use std::path::Path;
use std::time::Duration;

use crate::runtime::artifact_install::*;
use crate::time::{Clock, Sleeper};

pub(super) fn run_with_retry<T, C, S, F>(
    budget: &StepBudget<'_, C>,
    sleeper: &S,
    mut operation: F,
) -> Result<T, String>
where
    C: Clock,
    S: Sleeper,
    F: FnMut(Option<Duration>) -> Result<T, RetryableFailure>,
{
    for attempt_index in 0..GITHUB_RELEASE_ATTEMPTS {
        let remaining_timeout = budget.remaining_timeout_duration()?;
        match operation(remaining_timeout) {
            Ok(value) => return Ok(value),
            Err(error) => {
                let attempts_remaining = GITHUB_RELEASE_ATTEMPTS - attempt_index - 1;
                if !error.retryable || attempts_remaining == 0 {
                    return Err(error.message);
                }

                let backoff_ms = GITHUB_RELEASE_RETRY_BACKOFFS_MS
                    .get(attempt_index)
                    .copied()
                    .unwrap_or_default();
                budget.ensure_can_wait(backoff_ms)?;
                sleeper.sleep(Duration::from_millis(backoff_ms));
            }
        }
    }

    Err("github release retry loop exhausted unexpectedly".to_string())
}

pub(super) fn stream_download_to_path_with_retry<C, S, F>(
    download_path: &Path,
    budget: &StepBudget<'_, C>,
    sleeper: &S,
    mut operation: F,
) -> Result<(), String>
where
    C: Clock,
    S: Sleeper,
    F: FnMut(Option<Duration>, &mut File) -> Result<(), RetryableFailure>,
{
    run_with_retry(budget, sleeper, |remaining_timeout| {
        let mut download_file = File::create(download_path).map_err(|error| RetryableFailure {
            message: format!("failed to create download staging file: {error}"),
            retryable: false,
        })?;
        operation(remaining_timeout, &mut download_file)
    })
}

pub(super) struct StepBudget<'a, C> {
    timeout_ms: Option<u64>,
    started_at_ms: u64,
    clock: &'a C,
}

impl<'a, C> StepBudget<'a, C>
where
    C: Clock,
{
    pub(super) fn new(timeout_ms: Option<u64>, clock: &'a C) -> Self {
        Self {
            timeout_ms,
            started_at_ms: clock.now_ms(),
            clock,
        }
    }

    pub(super) fn remaining_timeout_duration(&self) -> Result<Option<Duration>, String> {
        let Some(timeout_ms) = self.timeout_ms else {
            return Ok(None);
        };
        let elapsed_ms = self.clock.now_ms().saturating_sub(self.started_at_ms);
        let remaining_ms = timeout_ms.saturating_sub(elapsed_ms);
        if remaining_ms == 0 {
            return Err(format!(
                "github release install timed out after {timeout_ms}ms"
            ));
        }

        Ok(Some(Duration::from_millis(remaining_ms)))
    }

    pub(super) fn ensure_can_wait(&self, duration_ms: u64) -> Result<(), String> {
        let Some(timeout_ms) = self.timeout_ms else {
            return Ok(());
        };
        let elapsed_ms = self.clock.now_ms().saturating_sub(self.started_at_ms);
        let remaining_ms = timeout_ms.saturating_sub(elapsed_ms);
        if remaining_ms <= duration_ms {
            return Err(format!(
                "github release install timed out after {timeout_ms}ms"
            ));
        }
        Ok(())
    }
}

pub(super) struct RetryableFailure {
    pub(super) message: String,
    pub(super) retryable: bool,
}
