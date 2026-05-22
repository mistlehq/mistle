//! Aggregate readiness worker for initialized sandbox daemon state.
//!
//! The worker polls component snapshots through the supervisor and updates the
//! runtime readiness manager used by health checks.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::runtime::readiness::{
    RuntimeReadinessManager, RuntimeReadinessMode, derive_runtime_ready,
};
use crate::supervision::SandboxdSupervisorHandle;

const RUNTIME_READINESS_PROJECTION_POLL_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(100);

pub(super) fn sync_runtime_readiness_from_snapshot(
    supervisor_handle: &SandboxdSupervisorHandle,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
    runtime_readiness_mode: RuntimeReadinessMode,
) {
    let ready = derive_runtime_ready(&supervisor_handle.snapshot(), runtime_readiness_mode);
    match runtime_readiness_manager.lock() {
        Ok(mut runtime_readiness_manager) => runtime_readiness_manager.set_ready(ready),
        Err(error) => {
            eprintln!("sandboxd failed to sync runtime readiness from snapshot: {error}");
        }
    }
}

pub(super) fn spawn_runtime_readiness_projection_thread(
    supervisor_handle: SandboxdSupervisorHandle,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    runtime_readiness_mode: RuntimeReadinessMode,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_runtime_readiness_projection_loop(
            supervisor_handle,
            runtime_readiness_manager,
            runtime_readiness_mode,
            shutdown_requested,
        );
    })
}

fn run_runtime_readiness_projection_loop(
    supervisor_handle: SandboxdSupervisorHandle,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    runtime_readiness_mode: RuntimeReadinessMode,
    shutdown_requested: Arc<AtomicBool>,
) {
    let mut last_projected_ready = None;

    while !shutdown_requested.load(Ordering::Relaxed) {
        let projected_ready =
            derive_runtime_ready(&supervisor_handle.snapshot(), runtime_readiness_mode);
        if last_projected_ready != Some(projected_ready) {
            match runtime_readiness_manager.lock() {
                Ok(mut runtime_readiness_manager) => {
                    runtime_readiness_manager.set_ready(projected_ready);
                    last_projected_ready = Some(projected_ready);
                }
                Err(error) => {
                    eprintln!("sandboxd failed to project runtime readiness: {error}");
                }
            }
        }
        thread::sleep(RUNTIME_READINESS_PROJECTION_POLL_INTERVAL);
    }
}
