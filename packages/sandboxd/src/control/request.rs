//! Request dispatch for the daemon-local control socket.
//!
//! The socket server accepts one request per connection. Most requests complete
//! inline, while initialization may hand work to a background thread so the
//! daemon remains responsive to readiness, wait, and signing traffic.

use std::collections::BTreeMap;
use std::io::Read;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::control::protocol::{ControlRequest, ControlResponse, ControlSignRequest};
use crate::control::state::{SharedInitThread, lock_control_state, lock_init_thread};
use crate::control::{ControlError, InitPhase};
use crate::protocol::startup::StartupInput;
use crate::sandboxd_state::SandboxdState;
use crate::security;
use crate::startup_diagnostics::{
    StartupDiagnosticsLogger, StartupOperation, startup_diagnostics_string,
};
use crate::time::{SystemClock, ThreadSleeper};
use crate::tunnel::session::{
    TunnelSigningRequest, TunnelSigningResponse, derive_sandbox_instance_id,
};

static SIGN_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) fn handle_connection(
    stream: &mut UnixStream,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
    init_thread: &SharedInitThread,
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
        ControlRequest::Init {
            startup_input,
            wait_for_completion,
            wait_for_storage_attach,
        } => {
            begin_init(
                startup_input,
                state,
                init_thread,
                wait_for_completion,
                wait_for_storage_attach,
            )?;
            Ok(ControlResponse::ok(None))
        }
        ControlRequest::Resume { startup_input } => {
            begin_resume(startup_input, state)?;
            Ok(ControlResponse::ok(None))
        }
        ControlRequest::WaitInit => {
            crate::control::state::join_init_thread(init_thread)?;
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
    let startup_input = state_guard.startup_input.as_ref().ok_or_else(|| {
        ControlError::StartupRequestRejected("sandboxd is not initialized".to_string())
    })?;
    let git_signing_config = startup_input
        .git_identity
        .as_ref()
        .and_then(|git_identity| git_identity.signing.as_ref())
        .ok_or_else(|| {
            ControlError::StartupRequestRejected(
                "sandbox does not have a configured Git signing identity".to_string(),
            )
        })?;
    let tunnel_session = state_guard.sandboxd_state.as_ref().ok_or_else(|| {
        ControlError::StartupRequestRejected(
            "sandboxd state is missing for an initialized daemon".to_string(),
        )
    })?;

    if git_signing_config.key_ref != sign_request.key_ref {
        return Err(ControlError::StartupRequestRejected(
            "requested Git signing key does not match the configured Git signing identity"
                .to_string(),
        ));
    }

    let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)
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

fn begin_init(
    startup_input: StartupInput,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
    init_thread: &SharedInitThread,
    wait_for_completion: bool,
    wait_for_storage_attach: bool,
) -> Result<(), ControlError> {
    {
        let mut state_guard = lock_control_state(state)?;
        match &state_guard.init_phase {
            InitPhase::Uninitialized => {
                state_guard.init_phase = InitPhase::Initializing;
                state_guard.startup_input = Some(startup_input.clone());
            }
            InitPhase::Initializing => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd is already initializing".to_string(),
                ));
            }
            InitPhase::Initialized => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd has already completed initialization".to_string(),
                ));
            }
            InitPhase::Failed(error) => {
                return Err(ControlError::StartupRequestRejected(format!(
                    "sandboxd initialization already failed: {error}"
                )));
            }
        }
    }

    let mut init_thread_guard = lock_init_thread(init_thread)?;
    if init_thread_guard.is_some() {
        return Err(ControlError::StartupRequestRejected(
            "sandboxd init worker is already running".to_string(),
        ));
    }

    let state_for_thread = state.clone();
    let global_git_config_path = lock_control_state(state)?.global_git_config_path.clone();
    let diagnostics_logger = StartupDiagnosticsLogger::initialize(
        StartupOperation::Init,
        &startup_input.tunnel_gateway_ws_url,
    )
    .ok();
    if let Some(logger) = &diagnostics_logger
        && let Err(error) = logger.record_started()
    {
        eprintln!("sandboxd failed to record init diagnostics start event: {error}");
    }
    // Initialization owns the long-running sandbox state transition; running it
    // off the socket accept loop keeps local health and wait requests available.
    *init_thread_guard = Some(thread::spawn(move || {
        let result = SandboxdState::initialize(
            &startup_input,
            &global_git_config_path,
            Arc::new(SystemClock),
            Arc::new(ThreadSleeper),
            diagnostics_logger.clone(),
            wait_for_storage_attach,
        );

        match result {
            Ok(sandboxd_state) => {
                let mut state_guard = lock_control_state(&state_for_thread)?;
                state_guard.shutdown_after_init = startup_input.is_snapshot();
                state_guard.sandboxd_state = Some(sandboxd_state);
                state_guard.init_phase = InitPhase::Initialized;
                Ok(())
            }
            Err(error) => {
                let error_text = error.to_string();
                if let Some(logger) = &diagnostics_logger
                    && let Err(record_error) = logger.record_failed(BTreeMap::from([(
                        "error".to_string(),
                        startup_diagnostics_string(error_text.clone()),
                    )]))
                {
                    eprintln!(
                        "sandboxd failed to record init diagnostics failure event: {record_error}"
                    );
                }
                lock_control_state(&state_for_thread)?.init_phase =
                    InitPhase::Failed(error_text.clone());
                Err(ControlError::InitializeSandboxdState(error_text))
            }
        }
    }));
    drop(init_thread_guard);

    if wait_for_completion {
        crate::control::state::join_init_thread(init_thread)?;
    }
    Ok(())
}

fn begin_resume(
    startup_input: StartupInput,
    state: &Arc<Mutex<crate::control::state::ControlServerState>>,
) -> Result<(), ControlError> {
    let diagnostics_logger = StartupDiagnosticsLogger::initialize(
        StartupOperation::Resume,
        &startup_input.tunnel_gateway_ws_url,
    )
    .ok();
    if let Some(logger) = &diagnostics_logger
        && let Err(error) = logger.record_started()
    {
        eprintln!("sandboxd failed to record resume diagnostics start event: {error}");
    }
    let mut sandboxd_state = {
        let mut state_guard = lock_control_state(state)?;
        match &state_guard.init_phase {
            InitPhase::Uninitialized => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd has not completed initialization".to_string(),
                ));
            }
            InitPhase::Initializing => {
                return Err(ControlError::StartupRequestRejected(
                    "sandboxd is still initializing".to_string(),
                ));
            }
            InitPhase::Initialized => {
                state_guard.startup_input = Some(startup_input.clone());
                state_guard.sandboxd_state.take().ok_or_else(|| {
                    ControlError::ResumeSandboxdState(
                        "sandboxd state is missing for an initialized daemon".to_string(),
                    )
                })?
            }
            InitPhase::Failed(error) => {
                return Err(ControlError::StartupRequestRejected(format!(
                    "sandboxd initialization already failed: {error}"
                )));
            }
        }
    };
    let global_git_config_path = lock_control_state(state)?.global_git_config_path.clone();

    let resume_result = sandboxd_state
        .resume(
            &startup_input,
            &global_git_config_path,
            diagnostics_logger.clone(),
        )
        .map_err(|error| {
            let error_text = error.to_string();
            if let Some(logger) = &diagnostics_logger
                && let Err(record_error) = logger.record_failed(BTreeMap::from([(
                    "error".to_string(),
                    startup_diagnostics_string(error_text.clone()),
                )]))
            {
                eprintln!(
                    "sandboxd failed to record resume diagnostics failure event: {record_error}"
                );
            }
            ControlError::ResumeSandboxdState(error_text)
        });

    lock_control_state(state)?.sandboxd_state = Some(sandboxd_state);

    resume_result
}
