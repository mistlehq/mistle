//! Request dispatch for the daemon-local control socket.
//!
//! The socket server accepts one request per connection. Most requests complete
//! inline, while activation may hand work to a background thread so the daemon
//! remains responsive to readiness and signing traffic.

use std::any::Any;
use std::collections::BTreeMap;
use std::io::Read;
use std::os::unix::net::UnixStream;
use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::control::protocol::{ControlRequest, ControlResponse, ControlSignRequest};
use crate::control::state::{
    ActivationCompletion, SharedActivationThread, lock_activation_thread, lock_control_state,
    notify_activation_completion, wait_for_activation_completion,
};
use crate::control::{ActivationPhase, ControlError};
use crate::protocol::activation::ActivationInput;
use crate::protocol::session::SessionRuntimeInput;
use crate::protocol::startup::ActivationOperationKind;
use crate::sandboxd_state::{SandboxdState, SandboxdStateError};
use crate::security;
use crate::startup_diagnostics::{
    ActivationDiagnosticsLogger, ActivationOperation, activation_diagnostics_string,
};
use crate::time::{SystemClock, ThreadSleeper};
use crate::tunnel::session::{
    TunnelSigningRequest, TunnelSigningResponse, derive_sandbox_instance_id,
};

static SIGN_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) fn handle_connection(
    stream: &mut UnixStream,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
    activation_thread: &SharedActivationThread,
    activation_completion: &ActivationCompletion,
) -> Result<ControlResponse, ControlError> {
    security::ensure_unix_socket_peer_matches_current_process_uid(stream)
        .map_err(|error| ControlError::VerifyPeer(error.to_string()))?;

    let mut raw_request = Vec::new();
    stream
        .read_to_end(&mut raw_request)
        .map_err(ControlError::ReadRequest)?;
    let request: ControlRequest =
        serde_json::from_slice(&raw_request).map_err(ControlError::InvalidRequest)?;

    match request {
        ControlRequest::Ready => Ok(ControlResponse::ok(None)),
        ControlRequest::Activate { activation_input } => {
            begin_activate(
                *activation_input,
                state,
                activation_thread,
                activation_completion,
            )?;
            Ok(ControlResponse::ok(None))
        }
        ControlRequest::Sign { sign_request } => {
            begin_sign(sign_request, state).map(|signature| ControlResponse::ok(Some(signature)))
        }
    }
}

fn begin_sign(
    sign_request: ControlSignRequest,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
) -> Result<String, ControlError> {
    let state_guard = lock_control_state(state)?;
    let (git_identity, tunnel_gateway_ws_url) =
        if let Some(activation_input) = state_guard.activation_input.as_ref() {
            (
                activation_input.git_identity.as_ref(),
                activation_input.tunnel_gateway_ws_url.as_str(),
            )
        } else {
            return Err(ControlError::StartupRequestRejected(
                "sandboxd is not activated".to_string(),
            ));
        };
    let git_signing_config = git_identity
        .and_then(|git_identity| git_identity.signing.as_ref())
        .ok_or_else(|| {
            ControlError::StartupRequestRejected(
                "sandbox does not have a configured Git signing identity".to_string(),
            )
        })?;
    let tunnel_session = state_guard.sandboxd_state.as_ref().ok_or_else(|| {
        ControlError::StartupRequestRejected(
            "sandboxd state is missing for an activated daemon".to_string(),
        )
    })?;

    if git_signing_config.key_ref != sign_request.key_ref {
        return Err(ControlError::StartupRequestRejected(
            "requested Git signing key does not match the configured Git signing identity"
                .to_string(),
        ));
    }

    let sandbox_instance_id = derive_sandbox_instance_id(tunnel_gateway_ws_url)
        .map_err(|error| ControlError::InitializeSandboxdState(error.to_string()))?;
    let request_id = format!(
        "sign_req_{}",
        SIGN_REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let signing_response = tunnel_session
        .request_signing(TunnelSigningRequest {
            request_id: request_id.clone(),
            organization_id: git_signing_config.organization_id.clone(),
            sandbox_instance_id,
            acting_user_id: git_signing_config.acting_user_id.clone(),
            provider_family: git_signing_config.provider_family.clone(),
            integration_connection_id: git_signing_config.integration_connection_id.clone(),
            format: git_signing_config.format.clone(),
            key_ref: sign_request.key_ref,
            grant: git_signing_config.grant.clone(),
            payload_base64: sign_request.payload_base64,
        })
        .map_err(|error| ControlError::ResponseError(error.to_string()))?;

    match signing_response {
        TunnelSigningResponse::Success {
            request_id: response_request_id,
            signature_base64,
        } => {
            if response_request_id != request_id {
                return Err(ControlError::ResponseError(format!(
                    "signing response request id '{response_request_id}' did not match '{request_id}'"
                )));
            }
            Ok(signature_base64)
        }
        TunnelSigningResponse::Failure {
            request_id: response_request_id,
            code,
            message,
        } => Err(ControlError::ResponseError(
            if response_request_id == request_id {
                format!("{code}: {message}")
            } else {
                format!(
                    "signing response request id '{response_request_id}' did not match '{request_id}': {code}: {message}"
                )
            },
        )),
    }
}

fn catch_init_unwind<F>(initialize: F) -> Result<Result<SandboxdState, SandboxdStateError>, String>
where
    F: FnOnce() -> Result<SandboxdState, SandboxdStateError>,
{
    panic::catch_unwind(AssertUnwindSafe(initialize))
        .map_err(|payload| format_panic_payload(payload.as_ref()))
}

fn format_panic_payload(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic payload".to_string()
}

fn record_init_failure(
    diagnostics_logger: &Option<ActivationDiagnosticsLogger>,
    error_text: String,
) {
    if let Some(logger) = diagnostics_logger
        && let Err(record_error) = logger.record_failed(BTreeMap::from([(
            "error".to_string(),
            activation_diagnostics_string(error_text),
        )]))
    {
        eprintln!("sandboxd failed to record init diagnostics failure event: {record_error}");
    }
}

fn publish_init_failure(
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
    activation_completion: &ActivationCompletion,
    error_text: String,
) -> Result<(), ControlError> {
    lock_control_state(state)?.activation_phase = ActivationPhase::Failed(error_text);
    notify_activation_completion(activation_completion);
    Ok(())
}

fn begin_activate(
    activation_input: ActivationInput,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
    activation_thread: &SharedActivationThread,
    activation_completion: &ActivationCompletion,
) -> Result<(), ControlError> {
    loop {
        {
            let mut state_guard = lock_control_state(state)?;
            match &state_guard.activation_phase {
                ActivationPhase::Unactivated => {
                    state_guard.activation_phase = ActivationPhase::Activating;
                    state_guard.activation_input = Some(activation_input.clone());
                    drop(state_guard);
                    start_activation_init_worker(
                        activation_input.clone(),
                        state,
                        activation_thread,
                        activation_completion,
                    )?;
                    crate::control::state::join_activation_thread(activation_thread)?;
                    match wait_for_activation_completion(state, activation_completion)? {
                        ActivationPhase::Activated => return Ok(()),
                        ActivationPhase::Unactivated => continue,
                        ActivationPhase::Failed(error) => {
                            return Err(ControlError::StartupRequestRejected(format!(
                                "sandboxd activation failed: {error}"
                            )));
                        }
                        ActivationPhase::Activating => {
                            return Err(ControlError::StartupRequestRejected(
                                "sandboxd is still initializing after activation wait".to_string(),
                            ));
                        }
                    }
                }
                ActivationPhase::Activating => {
                    drop(state_guard);
                    crate::control::state::join_activation_thread(activation_thread)?;
                    match wait_for_activation_completion(state, activation_completion)? {
                        ActivationPhase::Activated => continue,
                        ActivationPhase::Unactivated => continue,
                        ActivationPhase::Failed(error) => {
                            return Err(ControlError::StartupRequestRejected(format!(
                                "sandboxd activation already failed: {error}"
                            )));
                        }
                        ActivationPhase::Activating => {
                            return Err(ControlError::StartupRequestRejected(
                                "sandboxd is still initializing after activation wait".to_string(),
                            ));
                        }
                    }
                }
                ActivationPhase::Activated => {
                    if state_guard.activation_input.as_ref() == Some(&activation_input) {
                        return Ok(());
                    }
                    let accepted_activation_input =
                        accepted_activation_input_from_control_state(&state_guard)?;
                    reject_unsupported_activated_activation_input(
                        accepted_activation_input,
                        &activation_input,
                    )?;
                    let accepted_session_input =
                        SessionRuntimeInput::from_activation_input(accepted_activation_input);
                    let sandboxd_state = state_guard.sandboxd_state.take().ok_or_else(|| {
                        ControlError::ResumeSandboxdState(
                            "sandboxd state is missing for an activated daemon".to_string(),
                        )
                    })?;
                    drop(state_guard);
                    return refresh_activated_activation(
                        activation_input,
                        sandboxd_state,
                        accepted_session_input,
                        state,
                    );
                }
                ActivationPhase::Failed(error) => {
                    return Err(ControlError::StartupRequestRejected(format!(
                        "sandboxd activation already failed: {error}"
                    )));
                }
            }
        }
    }
}

fn accepted_activation_input_from_control_state(
    state_guard: &crate::control::state::ControlServerState,
) -> Result<&ActivationInput, ControlError> {
    if let Some(activation_input) = state_guard.activation_input.as_ref() {
        return Ok(activation_input);
    }
    Err(ControlError::StartupRequestRejected(
        "sandboxd is activated without accepted session input".to_string(),
    ))
}

fn reject_unsupported_activated_activation_input(
    accepted_activation_input: &ActivationInput,
    candidate_activation_input: &ActivationInput,
) -> Result<(), ControlError> {
    if accepted_activation_input.runtime_plan != candidate_activation_input.runtime_plan {
        return Err(ControlError::ResumeSandboxdState(
            "initialized activation cannot change runtime plan".to_string(),
        ));
    }
    Ok(())
}

fn refresh_activated_activation(
    activation_input: ActivationInput,
    mut sandboxd_state: SandboxdState,
    accepted_session_input: SessionRuntimeInput,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
) -> Result<(), ControlError> {
    let global_git_config_path = lock_control_state(state)?.global_git_config_path.clone();
    let diagnostics_logger = ActivationDiagnosticsLogger::initialize(
        ActivationOperation::Activation {
            operation_kind: activation_input.operation_kind,
        },
        &activation_input.tunnel_gateway_ws_url,
    )
    .ok();
    if let Some(logger) = &diagnostics_logger
        && let Err(error) = logger.record_started()
    {
        eprintln!("sandboxd failed to record activation diagnostics start event: {error}");
    }

    let activate_result = sandboxd_state
        .activate_initialized(
            &activation_input,
            &accepted_session_input,
            &global_git_config_path,
            diagnostics_logger.clone(),
        )
        .map_err(|error| {
            let error_text = error.to_string();
            if let Some(logger) = &diagnostics_logger
                && let Err(record_error) = logger.record_failed(BTreeMap::from([(
                    "error".to_string(),
                    activation_diagnostics_string(error_text.clone()),
                )]))
            {
                eprintln!(
                    "sandboxd failed to record activation diagnostics failure event: {record_error}"
                );
            }
            ControlError::ResumeSandboxdState(error_text)
        });

    let mut state_guard = lock_control_state(state)?;
    if activate_result.is_ok() {
        state_guard.activation_input = Some(activation_input);
    }
    state_guard.sandboxd_state = Some(sandboxd_state);
    activate_result
}

fn start_activation_init_worker(
    activation_input: ActivationInput,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
    activation_thread: &SharedActivationThread,
    activation_completion: &ActivationCompletion,
) -> Result<(), ControlError> {
    let mut activation_thread_guard = lock_activation_thread(activation_thread)?;
    if activation_thread_guard.is_some() {
        return Ok(());
    }

    let state_for_thread = state.clone();
    let activation_completion_for_thread = activation_completion.clone();
    let global_git_config_path = lock_control_state(state)?.global_git_config_path.clone();
    let diagnostics_logger = ActivationDiagnosticsLogger::initialize(
        ActivationOperation::Activation {
            operation_kind: activation_input.operation_kind,
        },
        &activation_input.tunnel_gateway_ws_url,
    )
    .ok();
    if let Some(logger) = &diagnostics_logger
        && let Err(error) = logger.record_started()
    {
        eprintln!("sandboxd failed to record activation diagnostics start event: {error}");
    }

    *activation_thread_guard = Some(thread::spawn(move || {
        let result = catch_init_unwind(|| {
            SandboxdState::activate_new(
                &activation_input,
                &global_git_config_path,
                Arc::new(SystemClock),
                Arc::new(ThreadSleeper),
                diagnostics_logger.clone(),
            )
        });

        match result {
            Ok(Ok(sandboxd_state)) => {
                let mut state_guard = lock_control_state(&state_for_thread)?;
                state_guard.shutdown_after_activation =
                    activation_input.operation_kind == ActivationOperationKind::Snapshot;
                state_guard.sandboxd_state = Some(sandboxd_state);
                state_guard.activation_phase = ActivationPhase::Activated;
                notify_activation_completion(&activation_completion_for_thread);
                Ok(())
            }
            Ok(Err(error)) => {
                let error_text = error.to_string();
                record_init_failure(&diagnostics_logger, error_text.clone());
                publish_init_failure(
                    &state_for_thread,
                    &activation_completion_for_thread,
                    error_text.clone(),
                )?;
                Err(ControlError::InitializeSandboxdState(error_text))
            }
            Err(panic_text) => {
                let error_text = format!("sandbox activation worker panicked: {panic_text}");
                record_init_failure(&diagnostics_logger, error_text.clone());
                publish_init_failure(
                    &state_for_thread,
                    &activation_completion_for_thread,
                    error_text,
                )?;
                Err(ControlError::InitPanicked)
            }
        }
    }));

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::control::request::catch_init_unwind;
    use crate::sandboxd_state::{SandboxdState, SandboxdStateError};

    #[test]
    fn init_panic_boundary_returns_panic_payload() {
        let result = catch_init_unwind(|| -> Result<SandboxdState, SandboxdStateError> {
            panic!("requested init panic")
        });

        match result {
            Ok(_) => panic!("init panic boundary should catch panics"),
            Err(error) => assert_eq!(error, "requested init panic"),
        }
    }
}
