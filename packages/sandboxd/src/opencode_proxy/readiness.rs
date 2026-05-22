//! Readiness projection for the OpenCode proxy component.
//!
//! The proxy is only healthy when its websocket listener is serving and the raw
//! OpenCode process readiness check has not crossed the unhealthy threshold.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::runtime::readiness::{
    RuntimeReadinessManager, RuntimeReadinessMode, derive_runtime_ready,
};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};

const OPENCODE_PROXY_READINESS_PROJECTION_INTERVAL: Duration = Duration::from_millis(100);

pub(super) struct LocalRuntimeReadinessProjection {
    pub(super) runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    pub(super) shutdown_requested: Arc<AtomicBool>,
    pub(super) thread: JoinHandle<()>,
}

pub(super) fn sync_opencode_proxy_runtime_readiness_from_snapshot(
    supervisor_handle: &SandboxdSupervisorHandle,
    runtime_readiness_manager: &Arc<Mutex<RuntimeReadinessManager>>,
) {
    let ready = derive_runtime_ready(
        &supervisor_handle.snapshot(),
        opencode_readiness_mode(supervisor_handle),
    );
    runtime_readiness_manager
        .lock()
        .expect("runtime readiness manager lock should not be poisoned")
        .set_ready(ready);
}

fn opencode_readiness_mode(supervisor_handle: &SandboxdSupervisorHandle) -> RuntimeReadinessMode {
    if supervisor_handle.tracks_component(SupervisedComponent::OpenCodeServer) {
        RuntimeReadinessMode::OpenCode
    } else {
        RuntimeReadinessMode::OpenCodeProxyOnly
    }
}

pub(super) fn spawn_opencode_proxy_runtime_readiness_projection(
    supervisor_handle: SandboxdSupervisorHandle,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut last_projected_ready = None;

        while !shutdown_requested.load(Ordering::Relaxed) {
            let projected_ready = derive_runtime_ready(
                &supervisor_handle.snapshot(),
                opencode_readiness_mode(&supervisor_handle),
            );
            if last_projected_ready != Some(projected_ready) {
                runtime_readiness_manager
                    .lock()
                    .expect("runtime readiness manager lock should not be poisoned")
                    .set_ready(projected_ready);
                last_projected_ready = Some(projected_ready);
            }
            thread::sleep(OPENCODE_PROXY_READINESS_PROJECTION_INTERVAL);
        }
    })
}
