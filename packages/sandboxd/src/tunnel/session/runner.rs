//! Async supervisor and connected-session loop for the live tunnel session.

use std::collections::{BTreeMap, VecDeque};
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::FutureExt;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::supervision::SupervisedComponent;
use crate::tunnel::session::TunnelSessionError;
use crate::tunnel::session::bootstrap::{
    TunnelWebSocket, build_tunnel_exchange_http_client, connect_bootstrap_websocket,
    reconnect_bootstrap_tunnel, resolve_bootstrap_tunnel_url, resolve_tunnel_exchange_url,
    send_telemetry_frames, spawn_bootstrap_socket_task, spawn_tunnel_wake_thread,
    write_tunnel_close, write_tunnel_text,
};
use crate::tunnel::session::egress::fail_pending_egress_token_requests;
use crate::tunnel::session::exec::cancel_pending_exec_open;
use crate::tunnel::session::lifecycle::{
    format_panic_payload, forward_supervisor_lifecycle_events, mark_tunnel_connected,
    mark_tunnel_disconnected, publish_initial_runtime_readiness, snapshot_runtime_connection_state,
    sync_pty_scope_keepalive, update_tunnel_supervision_details,
};
use crate::tunnel::session::operation::operation_open;
use crate::tunnel::session::process::ProcessStreamState;
use crate::tunnel::session::router::{handle_tunnel_session_event, handle_tunnel_session_request};
use crate::tunnel::session::signing::fail_pending_signing_requests;
use crate::tunnel::session::state::{
    ConnectedTunnelSessionLoopItem, ConnectedTunnelSessionOutcome, ConnectedTunnelSessionResult,
    TunnelSessionControlFlow, TunnelSessionLoopContext, TunnelSessionMutableState,
    TunnelSessionRequest, TunnelSessionRuntime,
};
use crate::tunnel::telemetry::TelemetryRelay;

pub(in crate::tunnel::session) async fn run_tunnel_supervisor(
    runtime: TunnelSessionRuntime,
    gateway_ws_url: &str,
    bootstrap_token: &str,
    tunnel_exchange_token: &str,
    request_receiver: mpsc::UnboundedReceiver<TunnelSessionRequest>,
    startup_result_sender: std::sync::mpsc::Sender<Result<(), TunnelSessionError>>,
) -> Result<(), TunnelSessionError> {
    let initial_connected_url = resolve_bootstrap_tunnel_url(gateway_ws_url, bootstrap_token)?;
    let (bootstrap_socket, _) = match connect_bootstrap_websocket(
        initial_connected_url.as_str(),
        runtime.transparent_passthrough_socket_mark,
    )
    .await
    {
        Ok(value) => value,
        Err(startup_error) => {
            let startup_error_text = startup_error.to_string();
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                gateway_ws_url,
                Some("bootstrap_connect_failed"),
                Some(1),
                None,
            );
            runtime.supervisor_handle.mark_component_restarting(
                SupervisedComponent::TunnelSession,
                startup_error_text.clone(),
            );
            runtime.supervisor_handle.emit_component_healthcheck_failed(
                SupervisedComponent::TunnelSession,
                "bootstrap_connect_failed",
                startup_error_text.clone(),
                "bootstrap_connection",
                &[],
            );
            let _ = startup_result_sender.send(Err(TunnelSessionError::ConfigureTunnelSocket(
                startup_error_text,
            )));
            return Err(startup_error);
        }
    };
    let mut current_tunnel_exchange_token = tunnel_exchange_token.to_string();

    let mut request_receiver = request_receiver;
    let mut session_result = run_connected_tunnel_session_catching_panics(
        &runtime,
        bootstrap_socket,
        &mut request_receiver,
        Some(&startup_result_sender),
    )
    .await;
    if !session_result.startup_completed {
        return Ok(());
    }
    let token_exchange_url = resolve_tunnel_exchange_url(gateway_ws_url)?;
    let tunnel_exchange_client = build_tunnel_exchange_http_client()?;

    loop {
        match session_result.outcome {
            ConnectedTunnelSessionOutcome::ShutdownRequested => {
                return Ok(());
            }
            ConnectedTunnelSessionOutcome::RestartRequired => {}
        }

        let Some(reconnected_socket) = reconnect_bootstrap_tunnel(
            &runtime,
            &tunnel_exchange_client,
            token_exchange_url.as_str(),
            gateway_ws_url,
            &mut current_tunnel_exchange_token,
        )
        .await?
        else {
            return Ok(());
        };

        session_result = run_connected_tunnel_session_catching_panics(
            &runtime,
            reconnected_socket,
            &mut request_receiver,
            None,
        )
        .await;
    }
}

pub(in crate::tunnel::session) async fn run_connected_tunnel_session_catching_panics(
    runtime: &TunnelSessionRuntime,
    bootstrap_socket: TunnelWebSocket,
    request_receiver: &mut mpsc::UnboundedReceiver<TunnelSessionRequest>,
    startup_result_sender: Option<&std::sync::mpsc::Sender<Result<(), TunnelSessionError>>>,
) -> ConnectedTunnelSessionResult {
    let startup_completed = Arc::new(AtomicBool::new(startup_result_sender.is_none()));
    match AssertUnwindSafe(run_connected_tunnel_session(
        runtime,
        bootstrap_socket,
        request_receiver,
        startup_result_sender,
        startup_completed.as_ref(),
    ))
    .catch_unwind()
    .await
    {
        Ok(result) => result,
        Err(payload) => {
            let panic_text = format_panic_payload(payload.as_ref());
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                &runtime.gateway_ws_url,
                Some("connected_session_panic"),
                None,
                None,
            );
            runtime
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, panic_text.clone());
            runtime.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "panic",
                Some(&panic_text),
                &[
                    ("exitKind", Value::String("panic".to_string())),
                    (
                        "panicBoundary",
                        Value::String("connected_session".to_string()),
                    ),
                ],
            );
            let startup_completed = startup_completed.load(Ordering::Relaxed);
            if let Some(startup_result_sender) = startup_result_sender
                && !startup_completed
            {
                let _ = startup_result_sender.send(Err(TunnelSessionError::SessionPanicked));
            }
            mark_tunnel_disconnected(runtime);
            ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed,
            }
        }
    }
}

async fn run_connected_tunnel_session(
    runtime: &TunnelSessionRuntime,
    bootstrap_socket: TunnelWebSocket,
    request_receiver: &mut mpsc::UnboundedReceiver<TunnelSessionRequest>,
    startup_result_sender: Option<&std::sync::mpsc::Sender<Result<(), TunnelSessionError>>>,
    startup_completed: &AtomicBool,
) -> ConnectedTunnelSessionResult {
    let (tunnel_writer_sender, tunnel_writer_receiver) = mpsc::unbounded_channel();
    let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
    let _bootstrap_socket_task = spawn_bootstrap_socket_task(
        bootstrap_socket,
        tunnel_writer_receiver,
        event_sender.clone(),
    );
    let _wake_thread = spawn_tunnel_wake_thread(
        runtime.shutdown_requested.clone(),
        runtime.sleeper.clone(),
        event_sender.clone(),
    );
    let connection_state = snapshot_runtime_connection_state(runtime);

    let mut session_state = TunnelSessionMutableState {
        agent_endpoint_url: connection_state.agent_endpoint_url,
        runtime_env: connection_state.runtime_env,
        telemetry_relay: TelemetryRelay::default(),
        pending_signing_requests: BTreeMap::new(),
        pending_egress_token_requests: BTreeMap::new(),
        pending_agent_opens: BTreeMap::new(),
        pending_exec_opens: BTreeMap::new(),
        agent_streams: BTreeMap::new(),
        port_access_http_streams: BTreeMap::new(),
        port_access_tcp_streams: BTreeMap::new(),
        process_streams: ProcessStreamState::default(),
        file_search_streams: BTreeMap::new(),
        operation_stream_requested: false,
        operation_stream_close_requested: false,
        operation_stream_close_response_sender: None,
        operation_stream_send_window: None,
        pending_operation_records: VecDeque::new(),
        file_uploads: BTreeMap::new(),
    };
    let telemetry_frames = match session_state.telemetry_relay.attach_tunnel_connection() {
        Ok(frames) => frames,
        Err(error) => {
            let error = TunnelSessionError::AttachTelemetry(error.to_string());
            let error_text = error.to_string();
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                &runtime.gateway_ws_url,
                Some("telemetry_attach_failed"),
                None,
                None,
            );
            runtime
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, error.to_string());
            runtime.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "thread_returned",
                Some(&error_text),
                &[("exitKind", Value::String("thread_returned".to_string()))],
            );
            mark_tunnel_disconnected(runtime);
            if let Some(startup_result_sender) = startup_result_sender {
                let _ = startup_result_sender.send(Err(error));
            }
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed: false,
            };
        }
    };
    match send_telemetry_frames(&tunnel_writer_sender, telemetry_frames) {
        Ok(()) => {
            mark_tunnel_connected(runtime);
            if let Some(operation_id) = runtime.operation_id.as_deref()
                && let Err(error) = write_tunnel_text(
                    &tunnel_writer_sender,
                    operation_open(operation_id, runtime.operation_kind),
                )
            {
                eprintln!("sandboxd failed to open operation stream: {error}");
            } else if runtime.operation_id.is_some() {
                session_state.operation_stream_requested = true;
            }
            forward_supervisor_lifecycle_events(
                &runtime.supervisor_handle,
                &mut session_state.telemetry_relay,
                &tunnel_writer_sender,
            );
        }
        Err(error) => {
            let error_text = error.to_string();
            update_tunnel_supervision_details(
                &runtime.supervisor_handle,
                &runtime.gateway_ws_url,
                Some("telemetry_open_failed"),
                None,
                None,
            );
            runtime
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, error.to_string());
            runtime.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "thread_returned",
                Some(&error_text),
                &[("exitKind", Value::String("thread_returned".to_string()))],
            );
            mark_tunnel_disconnected(runtime);
            if let Some(startup_result_sender) = startup_result_sender {
                let _ = startup_result_sender.send(Err(error));
            }
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed: false,
            };
        }
    }

    let loop_context = TunnelSessionLoopContext {
        attachment_root: &runtime.attachment_root,
        cgroup_root: &runtime.cgroup_root,
        sandbox_instance_id: &runtime.sandbox_instance_id,
        gateway_ws_url: &runtime.gateway_ws_url,
        clock: runtime.clock.as_ref(),
        supervisor_handle: &runtime.supervisor_handle,
    };

    if let Err(error) = publish_initial_runtime_readiness(runtime, &tunnel_writer_sender) {
        let error_text = error.to_string();
        update_tunnel_supervision_details(
            loop_context.supervisor_handle,
            loop_context.gateway_ws_url,
            Some("runtime_readiness_publish_failed"),
            None,
            None,
        );
        loop_context
            .supervisor_handle
            .mark_component_restarting(SupervisedComponent::TunnelSession, error_text.clone());
        loop_context.supervisor_handle.emit_component_exited(
            SupervisedComponent::TunnelSession,
            "thread_returned",
            Some(&error_text),
            &[("exitKind", Value::String("thread_returned".to_string()))],
        );
        mark_tunnel_disconnected(runtime);
        if let Some(startup_result_sender) = startup_result_sender {
            let _ = startup_result_sender.send(Err(error));
        }
        return ConnectedTunnelSessionResult {
            outcome: ConnectedTunnelSessionOutcome::RestartRequired,
            startup_completed: false,
        };
    }
    if let Some(startup_result_sender) = startup_result_sender {
        let _ = startup_result_sender.send(Ok(()));
    }
    startup_completed.store(true, Ordering::Relaxed);
    let startup_completed = true;

    loop {
        if let Err(error) = sync_pty_scope_keepalive(
            runtime.keepalive_manager.as_ref(),
            loop_context.cgroup_root,
            loop_context.sandbox_instance_id,
        ) {
            let error_text = error.to_string();
            update_tunnel_supervision_details(
                loop_context.supervisor_handle,
                loop_context.gateway_ws_url,
                Some("pty_keepalive_sync_failed"),
                None,
                None,
            );
            loop_context
                .supervisor_handle
                .mark_component_restarting(SupervisedComponent::TunnelSession, error_text.clone());
            loop_context.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "thread_returned",
                Some(&error_text),
                &[("exitKind", Value::String("thread_returned".to_string()))],
            );
            mark_tunnel_disconnected(runtime);
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                startup_completed,
            };
        }
        {
            let publishable_state = runtime
                .keepalive_manager
                .lock()
                .expect("keepalive manager lock should not be poisoned")
                .take_publishable_state(loop_context.clock);
            if let Some(state) = publishable_state {
                let payload = match serde_json::to_string(&state) {
                    Ok(payload) => payload,
                    Err(error) => {
                        let publish_error = TunnelSessionError::PublishKeepalive(error);
                        let publish_error_text = publish_error.to_string();
                        update_tunnel_supervision_details(
                            loop_context.supervisor_handle,
                            loop_context.gateway_ws_url,
                            Some("keepalive_publish_failed"),
                            None,
                            None,
                        );
                        loop_context.supervisor_handle.mark_component_restarting(
                            SupervisedComponent::TunnelSession,
                            publish_error_text.clone(),
                        );
                        loop_context.supervisor_handle.emit_component_exited(
                            SupervisedComponent::TunnelSession,
                            "thread_returned",
                            Some(&publish_error_text),
                            &[("exitKind", Value::String("thread_returned".to_string()))],
                        );
                        mark_tunnel_disconnected(runtime);
                        return ConnectedTunnelSessionResult {
                            outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                            startup_completed,
                        };
                    }
                };
                if let Err(error) = write_tunnel_text(&tunnel_writer_sender, payload) {
                    let error_text = error.to_string();
                    update_tunnel_supervision_details(
                        loop_context.supervisor_handle,
                        loop_context.gateway_ws_url,
                        Some("keepalive_publish_failed"),
                        None,
                        None,
                    );
                    loop_context.supervisor_handle.mark_component_restarting(
                        SupervisedComponent::TunnelSession,
                        error_text.clone(),
                    );
                    loop_context.supervisor_handle.emit_component_exited(
                        SupervisedComponent::TunnelSession,
                        "thread_returned",
                        Some(&error_text),
                        &[("exitKind", Value::String("thread_returned".to_string()))],
                    );
                    mark_tunnel_disconnected(runtime);
                    return ConnectedTunnelSessionResult {
                        outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                        startup_completed,
                    };
                }
            }
        }
        {
            let publishable_state = runtime
                .runtime_readiness_manager
                .lock()
                .expect("runtime readiness manager lock should not be poisoned")
                .take_publishable_state();
            if let Some(state) = publishable_state {
                let payload = match serde_json::to_string(&state) {
                    Ok(payload) => payload,
                    Err(error) => {
                        let publish_error = TunnelSessionError::PublishRuntimeReady(error);
                        let publish_error_text = publish_error.to_string();
                        update_tunnel_supervision_details(
                            loop_context.supervisor_handle,
                            loop_context.gateway_ws_url,
                            Some("runtime_readiness_publish_failed"),
                            None,
                            None,
                        );
                        loop_context.supervisor_handle.mark_component_restarting(
                            SupervisedComponent::TunnelSession,
                            publish_error_text.clone(),
                        );
                        loop_context.supervisor_handle.emit_component_exited(
                            SupervisedComponent::TunnelSession,
                            "thread_returned",
                            Some(&publish_error_text),
                            &[("exitKind", Value::String("thread_returned".to_string()))],
                        );
                        mark_tunnel_disconnected(runtime);
                        return ConnectedTunnelSessionResult {
                            outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                            startup_completed,
                        };
                    }
                };
                if let Err(error) = write_tunnel_text(&tunnel_writer_sender, payload) {
                    let error_text = error.to_string();
                    update_tunnel_supervision_details(
                        loop_context.supervisor_handle,
                        loop_context.gateway_ws_url,
                        Some("runtime_readiness_publish_failed"),
                        None,
                        None,
                    );
                    loop_context.supervisor_handle.mark_component_restarting(
                        SupervisedComponent::TunnelSession,
                        error_text.clone(),
                    );
                    loop_context.supervisor_handle.emit_component_exited(
                        SupervisedComponent::TunnelSession,
                        "thread_returned",
                        Some(&error_text),
                        &[("exitKind", Value::String("thread_returned".to_string()))],
                    );
                    mark_tunnel_disconnected(runtime);
                    return ConnectedTunnelSessionResult {
                        outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                        startup_completed,
                    };
                }
            }
        }
        let next_item = tokio::select! {
            event = event_receiver.recv() => event.map(ConnectedTunnelSessionLoopItem::Event),
            request = request_receiver.recv() => request.map(ConnectedTunnelSessionLoopItem::Request),
        };
        let Some(next_item) = next_item else {
            break;
        };

        if runtime.shutdown_requested.load(Ordering::Relaxed) {
            for pending_agent_open in session_state.pending_agent_opens.values() {
                pending_agent_open.task.abort();
            }
            for pending_exec_open in
                std::mem::take(&mut session_state.pending_exec_opens).into_values()
            {
                cancel_pending_exec_open(pending_exec_open);
            }
            if let Ok(frames) = session_state.telemetry_relay.detach_tunnel_connection() {
                let _ = send_telemetry_frames(&tunnel_writer_sender, frames);
            }
            fail_pending_signing_requests(
                &mut session_state,
                "bootstrap tunnel session shut down before a signing result arrived",
            );
            fail_pending_egress_token_requests(
                &mut session_state,
                "bootstrap tunnel session shut down before an egress token arrived",
            );
            mark_tunnel_disconnected(runtime);
            let _ = write_tunnel_close(&tunnel_writer_sender);
            return ConnectedTunnelSessionResult {
                outcome: ConnectedTunnelSessionOutcome::ShutdownRequested,
                startup_completed,
            };
        }

        let control_flow_result = match next_item {
            ConnectedTunnelSessionLoopItem::Event(event) => {
                handle_tunnel_session_event(
                    event,
                    &tunnel_writer_sender,
                    &event_sender,
                    &loop_context,
                    &mut session_state,
                )
                .await
            }
            ConnectedTunnelSessionLoopItem::Request(request) => handle_tunnel_session_request(
                request,
                &tunnel_writer_sender,
                runtime,
                &mut session_state,
            ),
        };

        match control_flow_result {
            Ok(TunnelSessionControlFlow::Continue) => {
                forward_supervisor_lifecycle_events(
                    loop_context.supervisor_handle,
                    &mut session_state.telemetry_relay,
                    &tunnel_writer_sender,
                );
            }
            Ok(TunnelSessionControlFlow::RestartRequired) => {
                fail_pending_signing_requests(
                    &mut session_state,
                    "bootstrap tunnel session restarted before a signing result arrived",
                );
                fail_pending_egress_token_requests(
                    &mut session_state,
                    "bootstrap tunnel session restarted before an egress token arrived",
                );
                mark_tunnel_disconnected(runtime);
                return ConnectedTunnelSessionResult {
                    outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                    startup_completed,
                };
            }
            Err(error) => {
                let error_text = error.to_string();
                update_tunnel_supervision_details(
                    loop_context.supervisor_handle,
                    loop_context.gateway_ws_url,
                    Some("connected_session_event_loop_failed"),
                    None,
                    None,
                );
                loop_context.supervisor_handle.mark_component_restarting(
                    SupervisedComponent::TunnelSession,
                    error_text.clone(),
                );
                loop_context.supervisor_handle.emit_component_exited(
                    SupervisedComponent::TunnelSession,
                    "thread_returned",
                    Some(&error_text),
                    &[("exitKind", Value::String("thread_returned".to_string()))],
                );
                fail_pending_signing_requests(
                    &mut session_state,
                    "bootstrap tunnel session failed before a signing result arrived",
                );
                fail_pending_egress_token_requests(
                    &mut session_state,
                    "bootstrap tunnel session failed before an egress token arrived",
                );
                mark_tunnel_disconnected(runtime);
                return ConnectedTunnelSessionResult {
                    outcome: ConnectedTunnelSessionOutcome::RestartRequired,
                    startup_completed,
                };
            }
        }
    }

    update_tunnel_supervision_details(
        &runtime.supervisor_handle,
        &runtime.gateway_ws_url,
        Some("event_channel_closed"),
        None,
        None,
    );
    runtime.supervisor_handle.mark_component_restarting(
        SupervisedComponent::TunnelSession,
        "bootstrap event channel closed".to_string(),
    );
    runtime.supervisor_handle.emit_component_exited(
        SupervisedComponent::TunnelSession,
        "thread_returned",
        Some("bootstrap event channel closed"),
        &[("exitKind", Value::String("thread_returned".to_string()))],
    );
    mark_tunnel_disconnected(runtime);
    ConnectedTunnelSessionResult {
        outcome: ConnectedTunnelSessionOutcome::RestartRequired,
        startup_completed,
    }
}
