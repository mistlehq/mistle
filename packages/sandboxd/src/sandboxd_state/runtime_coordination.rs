use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};

use crate::codex_proxy::CodexProxyControlHandle;
use crate::process::{CodexAppServerControlHandle, OpenCodeServerControlHandle};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};

const RUNTIME_COORDINATION_POLL_INTERVAL: std::time::Duration =
    std::time::Duration::from_millis(250);
const CODEX_PROXY_RECOVERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(Clone, Debug, Default)]
pub(super) struct RuntimeCoordinationHandles {
    pub(super) codex_app_server_control_handle: Option<CodexAppServerControlHandle>,
    pub(super) codex_proxy_control_handle: Option<CodexProxyControlHandle>,
    pub(super) opencode_server_control_handle: Option<OpenCodeServerControlHandle>,
}

impl RuntimeCoordinationHandles {
    pub(super) fn has_runtime_process_control(&self) -> bool {
        self.opencode_server_control_handle.is_some()
            || (self.codex_app_server_control_handle.is_some()
                && self.codex_proxy_control_handle.is_some())
    }
}

pub(super) fn spawn_runtime_coordination_thread(
    handles: RuntimeCoordinationHandles,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_runtime_coordination_loop(handles, supervisor_handle, shutdown_requested);
    })
}

fn run_runtime_coordination_loop(
    handles: RuntimeCoordinationHandles,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) {
    while !shutdown_requested.load(Ordering::Relaxed) {
        if let (Some(codex_app_server_control_handle), Some(codex_proxy_control_handle)) = (
            &handles.codex_app_server_control_handle,
            &handles.codex_proxy_control_handle,
        ) {
            coordinate_codex_runtime(
                codex_app_server_control_handle,
                codex_proxy_control_handle,
                &supervisor_handle,
                shutdown_requested.as_ref(),
            );
        }
        if let Some(opencode_server_control_handle) = &handles.opencode_server_control_handle {
            coordinate_opencode_runtime(opencode_server_control_handle, &supervisor_handle);
        }
        thread::sleep(RUNTIME_COORDINATION_POLL_INTERVAL);
    }
}

fn coordinate_codex_runtime(
    codex_app_server_control_handle: &CodexAppServerControlHandle,
    codex_proxy_control_handle: &CodexProxyControlHandle,
    supervisor_handle: &SandboxdSupervisorHandle,
    shutdown_requested: &AtomicBool,
) {
    let Some(codex_app_server_snapshot) =
        supervisor_handle.component_snapshot(SupervisedComponent::CodexAppServer)
    else {
        return;
    };
    if codex_app_server_snapshot.state != crate::supervision::ComponentHealthState::Restarting {
        return;
    }

    let restart_reason = component_restart_reason(&codex_app_server_snapshot);
    supervisor_handle.emit_component_restart_scheduled(
        SupervisedComponent::CodexAppServer,
        restart_reason,
        0,
        &[],
    );

    if codex_app_server_control_handle
        .restart(&crate::time::SystemClock, &crate::time::ThreadSleeper)
        .is_ok()
        && !wait_for_codex_proxy_recovery(
            codex_proxy_control_handle,
            CODEX_PROXY_RECOVERY_TIMEOUT,
            shutdown_requested,
        )
    {
        let _ = codex_proxy_control_handle.request_restart();
        let _ = wait_for_codex_proxy_recovery(
            codex_proxy_control_handle,
            CODEX_PROXY_RECOVERY_TIMEOUT,
            shutdown_requested,
        );
    }
}

fn coordinate_opencode_runtime(
    opencode_server_control_handle: &OpenCodeServerControlHandle,
    supervisor_handle: &SandboxdSupervisorHandle,
) {
    let Some(opencode_server_snapshot) =
        supervisor_handle.component_snapshot(SupervisedComponent::OpenCodeServer)
    else {
        return;
    };
    if opencode_server_snapshot.state != crate::supervision::ComponentHealthState::Restarting {
        return;
    }

    let restart_reason = component_restart_reason(&opencode_server_snapshot);
    supervisor_handle.emit_component_restart_scheduled(
        SupervisedComponent::OpenCodeServer,
        restart_reason,
        0,
        &[],
    );

    let _ = opencode_server_control_handle
        .restart(&crate::time::SystemClock, &crate::time::ThreadSleeper);
}

fn component_restart_reason(
    snapshot: &crate::supervision::ComponentHealthSnapshot,
) -> &'static str {
    if snapshot
        .details
        .get("livenessState")
        .is_some_and(|liveness_state| liveness_state == "Exited")
    {
        "coordinated_restart_after_exit"
    } else {
        "coordinated_restart_after_readiness_failure"
    }
}

fn wait_for_codex_proxy_recovery(
    codex_proxy_control_handle: &CodexProxyControlHandle,
    timeout: std::time::Duration,
    shutdown_requested: &AtomicBool,
) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            return false;
        }
        if let Some(snapshot) = codex_proxy_control_handle.snapshot() {
            let raw_connectivity_connected = snapshot
                .details
                .get("rawConnectivityState")
                .is_some_and(|state| state == "Connected");
            let session_manager_connected = snapshot
                .details
                .get("sessionManagerState")
                .is_some_and(|state| state == "Connected");
            if snapshot.state == crate::supervision::ComponentHealthState::Healthy
                && raw_connectivity_connected
                && session_manager_connected
            {
                return true;
            }
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        thread::sleep(RUNTIME_COORDINATION_POLL_INTERVAL);
    }
}
