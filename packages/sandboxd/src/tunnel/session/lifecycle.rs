//! Lifecycle, supervision, and publication helpers for the live tunnel session.

use std::any::Any;
use std::collections::BTreeMap;
use std::fmt::Display;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use serde_json::Value;
use tokio::sync::mpsc;

use crate::cgroups::{UserScopePaths, is_scope_populated};
use crate::keepalive::KeepaliveManager;
use crate::supervision::{
    SandboxdSupervisorHandle, SupervisedComponent, encode_forwarded_lifecycle_event_log_line,
};
use crate::time::Clock;
use crate::tunnel::session::TunnelSessionError;
use crate::tunnel::session::bootstrap::{
    TunnelWriterMessage, send_telemetry_frames, write_tunnel_text,
};
use crate::tunnel::session::state::{TunnelSessionRuntime, TunnelSessionRuntimeConnectionState};
use crate::tunnel::telemetry::{SandboxTelemetryLogLevel, TelemetryRelay};

pub(in crate::tunnel::session) fn publish_initial_runtime_readiness(
    runtime: &TunnelSessionRuntime,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
) -> Result<(), TunnelSessionError> {
    let publishable_state = runtime
        .runtime_readiness_manager
        .lock()
        .expect("runtime readiness manager lock should not be poisoned")
        .take_publishable_state()
        .ok_or_else(|| {
            TunnelSessionError::MissingRuntimeReadyState(
                "runtime readiness manager did not produce an initial state after tunnel attachment"
                    .to_string(),
            )
        })?;
    let payload = serde_json::to_string(&publishable_state)
        .map_err(TunnelSessionError::PublishRuntimeReady)?;

    write_tunnel_text(tunnel_writer_sender, payload)
}

pub(in crate::tunnel::session) fn snapshot_runtime_connection_state(
    runtime: &TunnelSessionRuntime,
) -> TunnelSessionRuntimeConnectionState {
    match runtime.connection_state.read() {
        Ok(connection_state) => connection_state.clone(),
        Err(poisoned_connection_state) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned connection state during connect; continuing with the poisoned state"
            );
            poisoned_connection_state.into_inner().clone()
        }
    }
}

pub(in crate::tunnel::session) fn set_runtime_agent_endpoint_url(
    runtime: &TunnelSessionRuntime,
    agent_endpoint_url: Option<String>,
) {
    match runtime.connection_state.write() {
        Ok(mut connection_state) => {
            connection_state.agent_endpoint_url = agent_endpoint_url;
        }
        Err(poisoned_connection_state) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned connection state during agent endpoint update; continuing with the poisoned state"
            );
            poisoned_connection_state.into_inner().agent_endpoint_url = agent_endpoint_url;
        }
    }
}

pub(in crate::tunnel::session) fn set_runtime_environment(
    runtime: &TunnelSessionRuntime,
    runtime_env: BTreeMap<String, String>,
) {
    match runtime.connection_state.write() {
        Ok(mut connection_state) => {
            connection_state.runtime_env = runtime_env;
        }
        Err(poisoned_connection_state) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned connection state during runtime environment update; continuing with the poisoned state"
            );
            poisoned_connection_state.into_inner().runtime_env = runtime_env;
        }
    }
}

pub(in crate::tunnel::session) fn mark_tunnel_connected(runtime: &TunnelSessionRuntime) {
    match runtime.keepalive_manager.lock() {
        Ok(mut keepalive_manager) => keepalive_manager.on_tunnel_connected(runtime.clock.as_ref()),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned keepalive manager during connect; continuing with the poisoned state"
            );
            poisoned_manager
                .into_inner()
                .on_tunnel_connected(runtime.clock.as_ref());
        }
    }
    match runtime.runtime_readiness_manager.lock() {
        Ok(mut runtime_readiness_manager) => runtime_readiness_manager.on_tunnel_connected(),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned runtime readiness manager during connect; continuing with the poisoned state"
            );
            poisoned_manager.into_inner().on_tunnel_connected();
        }
    }
    update_tunnel_supervision_details(
        &runtime.supervisor_handle,
        &runtime.gateway_ws_url,
        None,
        None,
        None,
    );
    runtime
        .supervisor_handle
        .mark_component_healthy(SupervisedComponent::TunnelSession);
}

pub(in crate::tunnel::session) fn mark_tunnel_disconnected(runtime: &TunnelSessionRuntime) {
    match runtime.keepalive_manager.lock() {
        Ok(mut keepalive_manager) => keepalive_manager.on_tunnel_disconnected(),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned keepalive manager during disconnect; continuing with the poisoned state"
            );
            poisoned_manager.into_inner().on_tunnel_disconnected();
        }
    }
    match runtime.runtime_readiness_manager.lock() {
        Ok(mut runtime_readiness_manager) => runtime_readiness_manager.on_tunnel_disconnected(),
        Err(poisoned_manager) => {
            eprintln!(
                "sandboxd bootstrap tunnel observed a poisoned runtime readiness manager during disconnect; continuing with the poisoned state"
            );
            poisoned_manager.into_inner().on_tunnel_disconnected();
        }
    }
}

pub(in crate::tunnel::session) fn forward_supervisor_lifecycle_events(
    supervisor_handle: &SandboxdSupervisorHandle,
    telemetry_relay: &mut TelemetryRelay,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
) {
    for line in supervisor_handle.drain_forwarded_lifecycle_event_lines() {
        let forwarded_line = match encode_forwarded_lifecycle_event_log_line(&line) {
            Ok(forwarded_line) => forwarded_line,
            Err(error) => {
                eprintln!("sandboxd failed to encode forwarded lifecycle telemetry: {error}");
                continue;
            }
        };
        let frames = match telemetry_relay.enqueue_log_line(&forwarded_line) {
            Ok(frames) => frames,
            Err(error) => {
                eprintln!("sandboxd failed to queue supervisor lifecycle telemetry: {error}");
                continue;
            }
        };
        if let Err(error) = send_telemetry_frames(tunnel_writer_sender, frames) {
            eprintln!("sandboxd failed to publish supervisor lifecycle telemetry: {error}");
        }
    }
}

pub(in crate::tunnel::session) fn update_tunnel_supervision_details(
    supervisor_handle: &SandboxdSupervisorHandle,
    gateway_ws_url: &str,
    last_reconnect_reason: Option<&str>,
    reconnect_attempt: Option<usize>,
    reconnect_backoff_ms: Option<u64>,
) {
    let mut details = BTreeMap::from([("gatewayWsUrl".to_string(), gateway_ws_url.to_string())]);
    if let Some(last_reconnect_reason) = last_reconnect_reason {
        details.insert(
            "lastReconnectReason".to_string(),
            last_reconnect_reason.to_string(),
        );
    }
    if let Some(reconnect_attempt) = reconnect_attempt {
        details.insert(
            "reconnectAttempt".to_string(),
            reconnect_attempt.to_string(),
        );
    }
    if let Some(reconnect_backoff_ms) = reconnect_backoff_ms {
        details.insert(
            "reconnectBackoffMs".to_string(),
            reconnect_backoff_ms.to_string(),
        );
    }
    supervisor_handle.replace_component_details(SupervisedComponent::TunnelSession, details);
}

pub(in crate::tunnel::session) fn sync_pty_scope_keepalive(
    keepalive_manager: &Mutex<KeepaliveManager>,
    cgroup_root: &Path,
    sandbox_instance_id: &str,
) -> Result<(), TunnelSessionError> {
    let any_user_scope_populated =
        any_populated_sandbox_user_scope(cgroup_root, sandbox_instance_id)?;

    keepalive_manager
        .lock()
        .expect("keepalive manager lock should not be poisoned")
        .set_user_active(any_user_scope_populated);

    Ok(())
}

pub(in crate::tunnel::session) fn report_dropped_bootstrap_text_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    reason: impl Display,
) {
    report_dropped_bootstrap_message(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        "bootstrap_control_message_dropped",
        format!("sandboxd dropped bootstrap control message: {reason}"),
        reason.to_string(),
    );
}

pub(in crate::tunnel::session) fn report_dropped_bootstrap_binary_frame(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    reason: impl Display,
) {
    report_dropped_bootstrap_message(
        tunnel_writer_sender,
        telemetry_relay,
        clock,
        "bootstrap_data_frame_dropped",
        format!("sandboxd dropped bootstrap data frame: {reason}"),
        reason.to_string(),
    );
}

pub(in crate::tunnel::session) fn format_panic_payload(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic payload".to_string()
}

fn any_populated_sandbox_user_scope(
    cgroup_root: &Path,
    sandbox_instance_id: &str,
) -> Result<bool, TunnelSessionError> {
    let user_root = cgroup_root.join(sandbox_instance_id).join("user");
    let entries = match fs::read_dir(&user_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(TunnelSessionError::Pty(format!(
                "failed to read sandbox user cgroup root {}: {error}",
                user_root.display()
            )));
        }
    };

    for entry_result in entries {
        let entry = entry_result.map_err(|error| {
            TunnelSessionError::Pty(format!(
                "failed to read sandbox user cgroup entry under {}: {error}",
                user_root.display()
            ))
        })?;
        let entry_type = entry.file_type().map_err(|error| {
            TunnelSessionError::Pty(format!(
                "failed to inspect sandbox user cgroup entry {}: {error}",
                entry.path().display()
            ))
        })?;
        if !entry_type.is_dir() {
            continue;
        }

        let scope_root = entry.path();
        let scope_paths = UserScopePaths {
            procs_file: scope_root.join("cgroup.procs"),
            events_file: scope_root.join("cgroup.events"),
            kill_file: scope_root.join("cgroup.kill"),
            scope_root,
        };
        let populated = match is_scope_populated(&scope_paths) {
            Ok(populated) => populated,
            Err(crate::cgroups::CgroupError::ReadFile { error, .. })
                if error.kind() == std::io::ErrorKind::NotFound =>
            {
                continue;
            }
            Err(error) => {
                return Err(TunnelSessionError::Pty(error.to_string()));
            }
        };
        if populated {
            return Ok(true);
        }
    }

    Ok(false)
}

fn report_dropped_bootstrap_message(
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    telemetry_relay: &mut TelemetryRelay,
    clock: &dyn Clock,
    event: &str,
    message: String,
    reason: String,
) {
    eprintln!("{message}");

    match telemetry_relay.enqueue_log_record(
        clock,
        SandboxTelemetryLogLevel::Warn,
        event,
        &[
            ("message", Value::String(message.clone())),
            ("reason", Value::String(reason)),
        ],
    ) {
        Ok(frames) => {
            if let Err(error) = send_telemetry_frames(tunnel_writer_sender, frames) {
                eprintln!(
                    "sandboxd failed to publish dropped bootstrap message telemetry: {error}"
                );
            }
        }
        Err(error) => {
            eprintln!("sandboxd failed to queue dropped bootstrap message telemetry: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use crate::keepalive::KeepaliveManager;
    use crate::tunnel::session::lifecycle::sync_pty_scope_keepalive;

    #[test]
    fn sync_pty_scope_keepalive_reads_populated_user_scopes_from_disk() {
        let test_dir = tempfile::TempDir::new().expect("temp dir should be created");
        let scope_paths =
            crate::cgroups::create_user_scope(test_dir.path(), "sbi_123", "scope_123")
                .expect("user scope should be created");
        std::fs::write(&scope_paths.events_file, "populated 1\n")
            .expect("scope events should be writable");
        let keepalive_manager = Mutex::new(KeepaliveManager::default());

        sync_pty_scope_keepalive(&keepalive_manager, test_dir.path(), "sbi_123")
            .expect("populated user scope should sync");

        assert!(
            keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .active(),
            "populated user scope should keep the sandbox active"
        );

        std::fs::write(&scope_paths.events_file, "populated 0\n")
            .expect("scope events should be writable");
        sync_pty_scope_keepalive(&keepalive_manager, test_dir.path(), "sbi_123")
            .expect("empty user scope should sync");

        assert!(
            !keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .active(),
            "empty user scope should clear sandbox keepalive"
        );
    }
}
