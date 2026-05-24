//! Handling for local requests sent into a tunnel session.
//!
//! Other sandboxd components use these request messages to open runtime streams,
//! perform signing, and coordinate work through the tunnel router.

use super::*;

pub(in crate::tunnel::session) fn handle_tunnel_session_request(
    request: TunnelSessionRequest,
    tunnel_writer_sender: &mpsc::UnboundedSender<TunnelWriterMessage>,
    runtime: &TunnelSessionRuntime,
    session_state: &mut TunnelSessionMutableState,
) -> Result<TunnelSessionControlFlow, TunnelSessionError> {
    match request {
        TunnelSessionRequest::SetAgentEndpoint {
            agent_endpoint_url,
            response_sender,
        } => {
            set_runtime_agent_endpoint_url(runtime, agent_endpoint_url.clone());
            session_state.agent_endpoint_url = agent_endpoint_url;
            let _ = response_sender.send(Ok(()));
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::SetRuntimeEnvironment {
            runtime_env,
            response_sender,
        } => {
            set_runtime_environment(runtime, runtime_env.clone());
            session_state.runtime_env = runtime_env;
            let _ = response_sender.send(Ok(()));
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::Signing {
            request,
            response_sender,
        } => continue_with(handle_signing_session_request(
            tunnel_writer_sender,
            session_state,
            *request,
            response_sender,
        )),
        TunnelSessionRequest::EgressToken {
            request_id,
            acting_user_id,
            response_sender,
        } => continue_with(handle_egress_token_session_request(
            tunnel_writer_sender,
            session_state,
            runtime.clock.as_ref(),
            runtime.sandbox_instance_id.as_str(),
            request_id,
            acting_user_id,
            response_sender,
        )),
        TunnelSessionRequest::OperationRecord { line } => {
            enqueue_operation_record(session_state, line);
            flush_pending_operation_records(tunnel_writer_sender, session_state);
            Ok(TunnelSessionControlFlow::Continue)
        }
        TunnelSessionRequest::OperationClose { response_sender } => {
            close_operation_stream(tunnel_writer_sender, session_state, response_sender);
            Ok(TunnelSessionControlFlow::Continue)
        }
    }
}

pub(in crate::tunnel::session) fn startup_operation_kind(
    startup_input: &StartupInput,
) -> &'static str {
    startup_input.operation_kind.as_str()
}

pub(in crate::tunnel::session) fn derive_startup_operation_id(
    tunnel_gateway_ws_url: &str,
) -> Option<String> {
    let Ok(url) = Url::parse(tunnel_gateway_ws_url) else {
        return None;
    };
    url.query_pairs().find_map(|(name, value)| {
        if name == "operation_id" && !value.is_empty() {
            Some(value.into_owned())
        } else {
            None
        }
    })
}
