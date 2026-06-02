//! Shared mutable state for the local control server.
//!
//! This module owns the lock helpers for daemon initialization state and the
//! optional initialization worker, so request handling and health projection use
//! one error path for poisoned locks.

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;

use crate::control::{ControlError, InitPhase};
use crate::protocol::activation::ActivationInput;
use crate::protocol::startup::StartupInput;
use crate::sandboxd_state::SandboxdState;

/// Tracks accepted startup input, live sandbox state, init phase, and snapshot shutdown behavior.
pub(super) struct ControlServerState {
    pub(super) init_phase: InitPhase,
    pub(super) startup_input: Option<StartupInput>,
    pub(super) activation_input: Option<ActivationInput>,
    pub(super) sandboxd_state: Option<SandboxdState>,
    pub(super) global_git_config_path: PathBuf,
    pub(super) shutdown_after_init: bool,
}

pub(super) type InitThread = JoinHandle<Result<(), ControlError>>;
pub(super) type SharedInitThread = Arc<Mutex<Option<InitThread>>>;
pub(super) type InitCompletion = Arc<Condvar>;

pub(super) fn lock_control_state(
    state: &Arc<Mutex<ControlServerState>>,
) -> Result<MutexGuard<'_, ControlServerState>, ControlError> {
    state
        .lock()
        .map_err(|_| ControlError::ControlStateLockPoisoned)
}

pub(super) fn lock_init_thread(
    init_thread: &SharedInitThread,
) -> Result<MutexGuard<'_, Option<InitThread>>, ControlError> {
    init_thread
        .lock()
        .map_err(|_| ControlError::InitThreadLockPoisoned)
}

pub(super) fn join_init_thread(init_thread: &SharedInitThread) -> Result<(), ControlError> {
    let Some(thread) = lock_init_thread(init_thread)?.take() else {
        return Ok(());
    };

    match thread.join() {
        Ok(result) => result,
        Err(_) => Err(ControlError::InitPanicked),
    }
}

pub(super) fn notify_init_completion(init_completion: &InitCompletion) {
    init_completion.notify_all();
}

pub(super) fn wait_for_init_completion(
    state: &Arc<Mutex<ControlServerState>>,
    init_completion: &InitCompletion,
) -> Result<InitPhase, ControlError> {
    let mut state_guard = lock_control_state(state)?;

    while matches!(state_guard.init_phase, InitPhase::Initializing) {
        state_guard = init_completion
            .wait(state_guard)
            .map_err(|_| ControlError::ControlStateLockPoisoned)?;
    }

    Ok(state_guard.init_phase.clone())
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
