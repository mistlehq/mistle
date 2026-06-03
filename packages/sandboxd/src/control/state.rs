//! Shared mutable state for the local control server.
//!
//! This module owns the lock helpers for daemon activation state and the
//! optional activation worker, so request handling and health projection use
//! one error path for poisoned locks.

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;

use crate::control::{ActivationPhase, ControlError};
use crate::protocol::activation::ActivationInput;
use crate::sandboxd_state::SandboxdState;

/// Tracks accepted activation input, live sandbox state, init phase, and snapshot shutdown behavior.
pub(super) struct ControlServerState {
    pub(super) activation_phase: ActivationPhase,
    pub(super) activation_input: Option<ActivationInput>,
    pub(super) sandboxd_state: Option<SandboxdState>,
    pub(super) global_git_config_path: PathBuf,
    pub(super) shutdown_after_activation: bool,
}

pub(super) type InitThread = JoinHandle<Result<(), ControlError>>;
pub(super) type SharedActivationThread = Arc<Mutex<Option<InitThread>>>;
pub(super) type ActivationCompletion = Arc<Condvar>;

pub(super) fn lock_control_state(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<MutexGuard<'_, ControlServerState>, ControlError> {
    state
        .lock()
        .map_err(|_| ControlError::ControlStateLockPoisoned)
}

pub(super) fn lock_activation_thread(
    activation_thread: &SharedActivationThread,
) -> Result<MutexGuard<'_, Option<InitThread>>, ControlError> {
    activation_thread
        .lock()
        .map_err(|_| ControlError::InitThreadLockPoisoned)
}

pub(super) fn join_activation_thread(
    activation_thread: &SharedActivationThread,
) -> Result<(), ControlError> {
    let Some(thread) = lock_activation_thread(activation_thread)?.take() else {
        return Ok(());
    };

    match thread.join() {
        Ok(result) => result,
        Err(_) => Err(ControlError::InitPanicked),
    }
}

pub(super) fn notify_activation_completion(activation_completion: &ActivationCompletion) {
    activation_completion.notify_all();
}

pub(super) fn wait_for_activation_completion(
    state: &Arc<Mutex<ControlServerState>>,
    activation_completion: &ActivationCompletion,
) -> Result<ActivationPhase, ControlError> {
    let mut state_guard = lock_control_state(state)?;

    while matches!(state_guard.activation_phase, ActivationPhase::Activating) {
        state_guard = activation_completion
            .wait(state_guard)
            .map_err(|_| ControlError::ControlStateLockPoisoned)?;
    }

    Ok(state_guard.activation_phase.clone())
}

fn take_sandboxd_state(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<Option<SandboxdState>, ControlError> {
    Ok(lock_control_state(state)?.sandboxd_state.take())
}

pub(super) fn close_sandboxd_state(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<(), ControlError> {
    take_sandboxd_state(state)?
        .map(SandboxdState::close)
        .transpose()
        .map_err(|error| ControlError::CloseSandboxdState(error.to_string()))?;
    Ok(())
}
