use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};

use crate::codex_proxy::CodexProxyControlHandle;
use crate::process::CodexAppServerControlHandle;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};

const CODEX_COORDINATION_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
const CODEX_PROXY_RECOVERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

pub(super) fn spawn_codex_coordination_thread(
    codex_app_server_control_handle: CodexAppServerControlHandle,
    codex_proxy_control_handle: CodexProxyControlHandle,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_codex_coordination_loop(
            codex_app_server_control_handle,
            codex_proxy_control_handle,
            supervisor_handle,
            shutdown_requested,
        );
    })
}

fn run_codex_coordination_loop(
    codex_app_server_control_handle: CodexAppServerControlHandle,
    codex_proxy_control_handle: CodexProxyControlHandle,
    supervisor_handle: SandboxdSupervisorHandle,
    shutdown_requested: Arc<AtomicBool>,
) {
    while !shutdown_requested.load(Ordering::Relaxed) {
        let codex_app_server_snapshot =
            supervisor_handle.component_snapshot(SupervisedComponent::CodexAppServer);
        let Some(codex_app_server_snapshot) = codex_app_server_snapshot else {
            break;
        };
        if codex_app_server_snapshot.state != crate::supervision::ComponentHealthState::Restarting {
            thread::sleep(CODEX_COORDINATION_POLL_INTERVAL);
            continue;
        }

        let restart_reason = if codex_app_server_snapshot
            .details
            .get("livenessState")
            .is_some_and(|liveness_state| liveness_state == "Exited")
        {
            "coordinated_restart_after_exit"
        } else {
            "coordinated_restart_after_readiness_failure"
        };
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
                &codex_proxy_control_handle,
                CODEX_PROXY_RECOVERY_TIMEOUT,
                shutdown_requested.as_ref(),
            )
        {
            let _ = codex_proxy_control_handle.request_restart();
            let _ = wait_for_codex_proxy_recovery(
                &codex_proxy_control_handle,
                CODEX_PROXY_RECOVERY_TIMEOUT,
                shutdown_requested.as_ref(),
            );
        }
        thread::sleep(CODEX_COORDINATION_POLL_INTERVAL);
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
        thread::sleep(CODEX_COORDINATION_POLL_INTERVAL);
    }
}
