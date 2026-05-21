use std::collections::{BTreeMap, VecDeque};
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{accept_async, connect_async};
use tracing::{field, info};
use tungstenite::Message;

use crate::codex_proxy::proxy_session::activity::{
    ActiveCompactionState, ActiveTurnState, ClientForwardContext, PendingCompactionRequest,
    TurnRequestKind, finalize_active_turns_for_transport_outcome,
    finalize_unresolved_compactions_for_transport_outcome, interruption_expected_for_source,
    interruption_source_for_client_kind, log_delivery_context_mapping,
    log_delivery_context_received, log_pending_thread_compaction_unknown_terminal_outcome,
    log_thread_compaction_request_failed, log_thread_compaction_requested,
    log_turn_interrupt_request_failed, log_turn_interrupt_requested, log_turn_lifecycle_event,
    log_turn_request_failure, observe_server_notification,
    read_interrupt_target_turn_id_from_request, read_response_error_message,
    request_kind_for_method, start_delivery_proxy_span, start_turn_lifecycle_span,
};
use crate::codex_proxy::proxy_session::delivery_context::{
    delivery_trace_id, delivery_webhook_event_id, parse_delivery_context_payload,
};
use crate::codex_proxy::proxy_session::json_rpc::{
    json_rpc_id_key, parse_json_rpc_id_from_message, parse_json_value_from_message,
};
use crate::codex_proxy::types::{
    BufferedSuccessResponse, DeliveryContext, PendingClientRequest, ProxyClientKind,
};
use crate::codex_proxy::{
    CodexProxyError, CodexSessionManagerError, CodexSessionManagerHandle,
    MISTLE_AGENT_CLIENT_TITLE, RetainReason, is_connection_termination_error,
};
const SET_DELIVERY_CONTEXT_METHOD: &str = "mistle/setDeliveryContext";
const THREAD_COMPACT_START_METHOD: &str = "thread/compact/start";
const TURN_START_METHOD: &str = "turn/start";
const TURN_STEER_METHOD: &str = "turn/steer";
const TURN_INTERRUPT_METHOD: &str = "turn/interrupt";
const RETENTION_FAILURE_ERROR_CODE: i64 = -32000;
const RETENTION_FAILURE_ERROR_MESSAGE: &str =
    "sandboxd failed to retain Codex thread subscription for background execution";

mod activity;
mod delivery_context;
mod json_rpc;

struct RetentionResult {
    request_key: String,
    result: Result<(), CodexSessionManagerError>,
}

struct MatchedRetentionTarget {
    request_key: String,
    thread_id: String,
    turn_id: String,
    request_kind: TurnRequestKind,
    expected_turn_id: Option<String>,
    request_started_at: Instant,
    delivery_context: Option<DeliveryContext>,
}

pub async fn relay_codex_proxy_connection(
    client_stream: TcpStream,
    raw_app_server_url: &str,
    session_manager_handle: CodexSessionManagerHandle,
    mut shutdown_receiver: watch::Receiver<bool>,
) -> Result<(), CodexProxyError> {
    let mut client_socket = accept_async(client_stream)
        .await
        .map_err(|error| CodexProxyError::AcceptHandshake(error.to_string()))?;
    let (mut raw_socket, _) = connect_async(raw_app_server_url)
        .await
        .map_err(CodexProxyError::ConnectRaw)?;

    let (retention_result_sender, mut retention_result_receiver) = mpsc::unbounded_channel();
    let mut client_kind = ProxyClientKind::Unknown;
    let mut current_delivery_context: Option<DeliveryContext> = None;
    let mut pending_requests = BTreeMap::<String, PendingClientRequest>::new();
    let mut thread_delivery_contexts = BTreeMap::<String, DeliveryContext>::new();
    let mut turn_delivery_contexts = BTreeMap::<String, DeliveryContext>::new();
    let mut active_turns = BTreeMap::<String, ActiveTurnState>::new();
    let mut pending_compaction_requests = BTreeMap::<String, PendingCompactionRequest>::new();
    let mut active_compactions = BTreeMap::<String, ActiveCompactionState>::new();
    let mut buffered_success_responses = VecDeque::<BufferedSuccessResponse>::new();
    let mut next_response_sequence = 0_u64;

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => {
                finalize_active_turns_for_transport_outcome(
                    &mut active_turns,
                    "closed",
                    "shutdown",
                );
                finalize_unresolved_compactions_for_transport_outcome(
                    &mut pending_compaction_requests,
                    &mut active_compactions,
                    "shutdown",
                );
                return Ok(());
            },
            retention_result = retention_result_receiver.recv() => {
                if let Some(retention_result) = retention_result {
                    record_retention_result(&retention_result, &mut buffered_success_responses);
                } else {
                    finalize_active_turns_for_transport_outcome(
                        &mut active_turns,
                        "closed",
                        "retention_channel_closed",
                    );
                    finalize_unresolved_compactions_for_transport_outcome(
                        &mut pending_compaction_requests,
                        &mut active_compactions,
                        "retention_channel_closed",
                    );
                    return Ok(());
                }
            }
            client_message = client_socket.next() => {
                match client_message {
                    Some(Ok(message)) => {
                        if let Message::Close(frame) = message {
                            finalize_active_turns_for_transport_outcome(
                                &mut active_turns,
                                "closed",
                                "client_close",
                            );
                            finalize_unresolved_compactions_for_transport_outcome(
                                &mut pending_compaction_requests,
                                &mut active_compactions,
                                "client_close",
                            );
                            if let Err(error) = raw_socket.send(Message::Close(frame)).await {
                                return Err(CodexProxyError::WriteSocket(error));
                            }
                            return Ok(());
                        }

                        if should_forward_client_message(
                            &message,
                            &mut client_kind,
                            &mut current_delivery_context,
                            &mut ClientForwardContext {
                                thread_delivery_contexts: &thread_delivery_contexts,
                                turn_delivery_contexts: &turn_delivery_contexts,
                                active_turns: &mut active_turns,
                                pending_compaction_requests: &mut pending_compaction_requests,
                                pending_requests: &mut pending_requests,
                            },
                        )? && let Err(error) = raw_socket.send(message).await {
                            finalize_active_turns_for_transport_outcome(
                                &mut active_turns,
                                "reset",
                                "raw_write_error",
                            );
                            finalize_unresolved_compactions_for_transport_outcome(
                                &mut pending_compaction_requests,
                                &mut active_compactions,
                                "raw_write_error",
                            );
                            return Err(CodexProxyError::WriteSocket(error));
                        }
                    }
                    Some(Err(error)) if is_connection_termination_error(&error) => {
                        finalize_active_turns_for_transport_outcome(
                            &mut active_turns,
                            "closed",
                            "client_terminated",
                        );
                        finalize_unresolved_compactions_for_transport_outcome(
                            &mut pending_compaction_requests,
                            &mut active_compactions,
                            "client_terminated",
                        );
                        return Ok(());
                    }
                    Some(Err(error)) => {
                        finalize_active_turns_for_transport_outcome(
                            &mut active_turns,
                            "reset",
                            "client_socket_error",
                        );
                        finalize_unresolved_compactions_for_transport_outcome(
                            &mut pending_compaction_requests,
                            &mut active_compactions,
                            "client_socket_error",
                        );
                        return Err(CodexProxyError::ReadSocket(error));
                    }
                    None => {
                        finalize_active_turns_for_transport_outcome(
                            &mut active_turns,
                            "closed",
                            "client_stream_ended",
                        );
                        finalize_unresolved_compactions_for_transport_outcome(
                            &mut pending_compaction_requests,
                            &mut active_compactions,
                            "client_stream_ended",
                        );
                        return Ok(());
                    }
                }
            }
            raw_message = raw_socket.next() => {
                match raw_message {
                    Some(Ok(message)) => {
                        if let Message::Close(frame) = message {
                            finalize_active_turns_for_transport_outcome(
                                &mut active_turns,
                                "closed",
                                "raw_close",
                            );
                            finalize_unresolved_compactions_for_transport_outcome(
                                &mut pending_compaction_requests,
                                &mut active_compactions,
                                "raw_close",
                            );
                            if let Err(error) = client_socket.send(Message::Close(frame)).await {
                                return Err(CodexProxyError::WriteSocket(error));
                            }
                            return Ok(());
                        }

                        observe_server_notification(
                            &message,
                            &mut active_turns,
                            &thread_delivery_contexts,
                            &mut pending_compaction_requests,
                            &mut active_compactions,
                        )?;

                        if let Some(retention_target) =
                            matched_retention_target(
                                &message,
                                &client_kind,
                                &mut pending_requests,
                                &mut pending_compaction_requests,
                            )?
                        {
                            if let Some(delivery_context) = retention_target.delivery_context.clone()
                            {
                                thread_delivery_contexts
                                    .insert(retention_target.thread_id.clone(), delivery_context.clone());
                                turn_delivery_contexts
                                    .insert(retention_target.turn_id.clone(), delivery_context.clone());
                                if let (Some(thread_delivery_context), Some(turn_delivery_context)) = (
                                    thread_delivery_contexts
                                        .get(retention_target.thread_id.as_str()),
                                    turn_delivery_contexts
                                        .get(retention_target.turn_id.as_str()),
                                ) {
                                    debug_assert_eq!(
                                        thread_delivery_context.delivery_task_id,
                                        turn_delivery_context.delivery_task_id
                                    );
                                    log_delivery_context_mapping(
                                        turn_delivery_context,
                                        retention_target.thread_id.as_str(),
                                        retention_target.turn_id.as_str(),
                                    );
                                }

                                let active_turn = ActiveTurnState {
                                    delivery_context: delivery_context.clone(),
                                    thread_id: retention_target.thread_id.clone(),
                                    turn_id: retention_target.turn_id.clone(),
                                    expected_turn_id: retention_target.expected_turn_id.clone(),
                                    request_kind: retention_target.request_kind,
                                    request_started_at: retention_target.request_started_at,
                                    started_at: None,
                                    first_item_at: None,
                                    first_item_type: None,
                                    interruption_source: None,
                                    interruption_expected: None,
                                    span: start_turn_lifecycle_span(
                                        retention_target.request_kind,
                                        &delivery_context,
                                        retention_target.thread_id.as_str(),
                                        retention_target.turn_id.as_str(),
                                        retention_target.expected_turn_id.as_deref(),
                                    ),
                                };
                                let accepted_outcome = match retention_target.request_kind {
                                    TurnRequestKind::Start => "started",
                                    TurnRequestKind::Steer => "steered",
                                };
                                log_turn_lifecycle_event(
                                    &active_turn,
                                    "codex_proxy.turn.accepted",
                                    accepted_outcome,
                                    None,
                                    Some(active_turn.request_started_at.elapsed().as_millis()),
                                );
                                active_turns.insert(retention_target.turn_id.clone(), active_turn);
                            }
                            next_response_sequence = next_response_sequence.saturating_add(1);
                            buffered_success_responses.push_back(BufferedSuccessResponse {
                                request_id: parse_json_rpc_id_from_message(&message)?,
                                response_sequence: next_response_sequence,
                                payload: message,
                                subscription_retention_result: None,
                            });
                            let retention_result_sender = retention_result_sender.clone();
                            let session_manager_handle = session_manager_handle.clone();
                            tokio::spawn(async move {
                                let result = session_manager_handle
                                    .retain_thread(
                                        retention_target.thread_id,
                                        RetainReason::MistleAgentBackgroundExecution,
                                    )
                                    .await;
                                let _ = retention_result_sender.send(RetentionResult {
                                    request_key: retention_target.request_key,
                                    result,
                                });
                            });
                        } else if let Err(error) = client_socket.send(message).await {
                            finalize_active_turns_for_transport_outcome(
                                &mut active_turns,
                                "reset",
                                "client_write_error",
                            );
                            finalize_unresolved_compactions_for_transport_outcome(
                                &mut pending_compaction_requests,
                                &mut active_compactions,
                                "client_write_error",
                            );
                            return Err(CodexProxyError::WriteSocket(error));
                        }
                    }
                    Some(Err(error)) if is_connection_termination_error(&error) => {
                        finalize_active_turns_for_transport_outcome(
                            &mut active_turns,
                            "reset",
                            "raw_terminated",
                        );
                        finalize_unresolved_compactions_for_transport_outcome(
                            &mut pending_compaction_requests,
                            &mut active_compactions,
                            "raw_terminated",
                        );
                        return Ok(());
                    }
                    Some(Err(error)) => {
                        finalize_active_turns_for_transport_outcome(
                            &mut active_turns,
                            "reset",
                            "raw_socket_error",
                        );
                        finalize_unresolved_compactions_for_transport_outcome(
                            &mut pending_compaction_requests,
                            &mut active_compactions,
                            "raw_socket_error",
                        );
                        return Err(CodexProxyError::ReadSocket(error));
                    }
                    None => {
                        finalize_active_turns_for_transport_outcome(
                            &mut active_turns,
                            "reset",
                            "raw_stream_ended",
                        );
                        finalize_unresolved_compactions_for_transport_outcome(
                            &mut pending_compaction_requests,
                            &mut active_compactions,
                            "raw_stream_ended",
                        );
                        return Ok(());
                    }
                }
            }
        }

        flush_buffered_success_responses(&mut client_socket, &mut buffered_success_responses)
            .await?;
    }
}

fn should_forward_client_message(
    message: &Message,
    client_kind: &mut ProxyClientKind,
    current_delivery_context: &mut Option<DeliveryContext>,
    forward_context: &mut ClientForwardContext<'_>,
) -> Result<bool, CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Ok(true);
    };

    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Ok(true);
    };

    if method == "initialize" {
        *client_kind = match value["params"]["clientInfo"]["title"].as_str() {
            Some(MISTLE_AGENT_CLIENT_TITLE) => ProxyClientKind::MistleAgentClient,
            _ => ProxyClientKind::Other,
        };
    }
    if method == SET_DELIVERY_CONTEXT_METHOD {
        let delivery_context = parse_delivery_context_payload(&value)?;
        log_delivery_context_received(&delivery_context);
        *current_delivery_context = Some(delivery_context);
        return Ok(false);
    }

    let Some(request_id) = value.get("id").cloned() else {
        return Ok(true);
    };
    let Some(request_key) = json_rpc_id_key(&request_id) else {
        return Ok(true);
    };
    let thread_id = match method {
        TURN_START_METHOD
        | TURN_STEER_METHOD
        | TURN_INTERRUPT_METHOD
        | THREAD_COMPACT_START_METHOD => value["params"]["threadId"]
            .as_str()
            .map(ToString::to_string),
        _ => None,
    };
    let expected_turn_id = match method {
        TURN_STEER_METHOD => value["params"]["expectedTurnId"]
            .as_str()
            .map(ToString::to_string),
        TURN_INTERRUPT_METHOD => read_interrupt_target_turn_id_from_request(&value),
        _ => None,
    };
    let delivery_context = match method {
        TURN_INTERRUPT_METHOD => expected_turn_id
            .as_deref()
            .and_then(|turn_id| forward_context.turn_delivery_contexts.get(turn_id).cloned())
            .or_else(|| {
                thread_id
                    .as_deref()
                    .and_then(|value| forward_context.thread_delivery_contexts.get(value).cloned())
            })
            .or_else(|| current_delivery_context.clone()),
        THREAD_COMPACT_START_METHOD => thread_id
            .as_deref()
            .and_then(|value| forward_context.thread_delivery_contexts.get(value).cloned())
            .or_else(|| current_delivery_context.clone()),
        _ => current_delivery_context.clone(),
    };
    let interruption_source = match method {
        TURN_INTERRUPT_METHOD => {
            Some(interruption_source_for_client_kind(*client_kind).to_string())
        }
        _ => None,
    };
    let interruption_expected = interruption_source
        .as_deref()
        .map(interruption_expected_for_source);
    let compaction_trigger = match method {
        THREAD_COMPACT_START_METHOD => Some("manual".to_string()),
        _ => None,
    };
    forward_context.pending_requests.insert(
        request_key,
        PendingClientRequest {
            method: method.to_string(),
            thread_id: thread_id.clone(),
            expected_turn_id: expected_turn_id.clone(),
            interruption_source: interruption_source.clone(),
            interruption_expected,
            compaction_trigger: compaction_trigger.clone(),
            request_started_at: Instant::now(),
            delivery_context: delivery_context.clone(),
        },
    );

    if method == TURN_INTERRUPT_METHOD
        && let (
            Some(delivery_context),
            Some(thread_id),
            Some(turn_id),
            Some(interruption_source),
            Some(interruption_expected),
        ) = (
            delivery_context.as_ref(),
            thread_id.as_deref(),
            expected_turn_id.as_deref(),
            interruption_source.as_deref(),
            interruption_expected,
        )
    {
        log_turn_interrupt_requested(
            delivery_context,
            thread_id,
            turn_id,
            interruption_source,
            interruption_expected,
            match client_kind {
                ProxyClientKind::MistleAgentClient => "mistle_agent_client",
                ProxyClientKind::Other => "other_client",
                ProxyClientKind::Unknown => "unknown_client",
            },
        );
        if let Some(active_turn) = forward_context.active_turns.get_mut(turn_id) {
            active_turn.interruption_source = Some(interruption_source.to_string());
            active_turn.interruption_expected = Some(interruption_expected);
        }
    }

    if let Some(delivery_context) = delivery_context.as_ref() {
        let delivery_span =
            start_delivery_proxy_span(method, delivery_context, thread_id.as_deref());
        let _entered = delivery_span.enter();
        info!(
            event = "codex_proxy.delivery_request.forwarded",
            "otel.trace_id" = %delivery_trace_id(delivery_context),
            "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
            "mistle.webhook_event_id" = %delivery_webhook_event_id(delivery_context),
            "rpc.method" = %method,
            "thread.id" = field::display(thread_id.as_deref().unwrap_or("")),
        );
    }

    if method == THREAD_COMPACT_START_METHOD
        && let Some(thread_id) = thread_id.as_deref()
        && let Some(pending_compaction_request) = forward_context
            .pending_compaction_requests
            .remove(thread_id)
    {
        log_pending_thread_compaction_unknown_terminal_outcome(
            pending_compaction_request.delivery_context.as_ref(),
            thread_id,
            pending_compaction_request.trigger.as_str(),
            "superseded_by_new_request",
            pending_compaction_request.requested_at,
        );
    }

    Ok(true)
}

fn matched_retention_target(
    message: &Message,
    client_kind: &ProxyClientKind,
    pending_requests: &mut BTreeMap<String, PendingClientRequest>,
    pending_compaction_requests: &mut BTreeMap<String, PendingCompactionRequest>,
) -> Result<Option<MatchedRetentionTarget>, CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Ok(None);
    };
    let Some(response_id) = value.get("id").cloned() else {
        return Ok(None);
    };
    let Some(request_key) = json_rpc_id_key(&response_id) else {
        return Ok(None);
    };
    let Some(pending_request) = pending_requests.remove(&request_key) else {
        return Ok(None);
    };

    let request_kind = request_kind_for_method(pending_request.method.as_str());
    if value.get("error").is_some() {
        if let (Some(request_kind), Some(delivery_context)) =
            (request_kind, pending_request.delivery_context.as_ref())
        {
            log_turn_request_failure(
                request_kind,
                delivery_context,
                pending_request.thread_id.as_deref(),
                pending_request.expected_turn_id.as_deref(),
                read_response_error_message(&value).as_deref(),
                pending_request.request_started_at.elapsed().as_millis(),
            );
        }
        if pending_request.method == TURN_INTERRUPT_METHOD
            && let (
                Some(delivery_context),
                Some(thread_id),
                Some(turn_id),
                Some(interruption_source),
            ) = (
                pending_request.delivery_context.as_ref(),
                pending_request.thread_id.as_deref(),
                pending_request.expected_turn_id.as_deref(),
                pending_request.interruption_source.as_deref(),
            )
        {
            log_turn_interrupt_request_failed(
                delivery_context,
                thread_id,
                turn_id,
                interruption_source,
                pending_request.interruption_expected.unwrap_or(false),
                read_response_error_message(&value).as_deref(),
                pending_request.request_started_at.elapsed().as_millis(),
            );
        }
        if pending_request.method == THREAD_COMPACT_START_METHOD
            && let Some(thread_id) = pending_request.thread_id.as_deref()
        {
            log_thread_compaction_request_failed(
                pending_request.delivery_context.as_ref(),
                thread_id,
                pending_request
                    .compaction_trigger
                    .as_deref()
                    .unwrap_or("unknown"),
                read_response_error_message(&value).as_deref(),
                pending_request.request_started_at.elapsed().as_millis(),
            );
        }
        return Ok(None);
    }
    if pending_request.method == THREAD_COMPACT_START_METHOD {
        if let Some(thread_id) = pending_request.thread_id.clone() {
            let trigger = pending_request
                .compaction_trigger
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            log_thread_compaction_requested(
                pending_request.delivery_context.as_ref(),
                thread_id.as_str(),
                trigger.as_str(),
                pending_request.request_started_at.elapsed().as_millis(),
            );
            pending_compaction_requests.insert(
                thread_id.clone(),
                PendingCompactionRequest {
                    delivery_context: pending_request.delivery_context,
                    requested_at: pending_request.request_started_at,
                    trigger,
                },
            );
        }
        return Ok(None);
    }
    if *client_kind != ProxyClientKind::MistleAgentClient {
        return Ok(None);
    }

    let Some(thread_id) = pending_request.thread_id else {
        return Ok(None);
    };
    let Some(request_kind) = request_kind else {
        return Ok(None);
    };
    let turn_id = match request_kind {
        TurnRequestKind::Start => value["result"]["turn"]["id"]
            .as_str()
            .map(ToString::to_string),
        TurnRequestKind::Steer => value["result"]["turnId"].as_str().map(ToString::to_string),
    };
    let Some(turn_id) = turn_id else {
        return Ok(None);
    };

    Ok(Some(MatchedRetentionTarget {
        request_key,
        thread_id,
        turn_id,
        request_kind,
        expected_turn_id: pending_request.expected_turn_id,
        request_started_at: pending_request.request_started_at,
        delivery_context: pending_request.delivery_context,
    }))
}

fn record_retention_result(
    retention_result: &RetentionResult,
    buffered_success_responses: &mut VecDeque<BufferedSuccessResponse>,
) {
    if let Some(buffered_success_response) =
        buffered_success_responses
            .iter_mut()
            .find(|buffered_success_response| {
                json_rpc_id_key(&buffered_success_response.request_id).as_deref()
                    == Some(retention_result.request_key.as_str())
            })
    {
        buffered_success_response.subscription_retention_result =
            Some(clone_retention_result(&retention_result.result));
    }
}

async fn flush_buffered_success_responses(
    client_socket: &mut tokio_tungstenite::WebSocketStream<TcpStream>,
    buffered_success_responses: &mut VecDeque<BufferedSuccessResponse>,
) -> Result<(), CodexProxyError> {
    for buffered_success_response in
        take_ready_buffered_success_responses(buffered_success_responses)
    {
        match buffered_success_response
            .subscription_retention_result
            .expect("buffered success response should have a retention result")
        {
            Ok(()) => client_socket
                .send(buffered_success_response.payload)
                .await
                .map_err(CodexProxyError::WriteSocket)?,
            Err(_) => client_socket
                .send(Message::Text(
                    json!({
                        "id": buffered_success_response.request_id,
                        "error": {
                            "code": RETENTION_FAILURE_ERROR_CODE,
                            "message": RETENTION_FAILURE_ERROR_MESSAGE
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .map_err(CodexProxyError::WriteSocket)?,
        }
    }

    Ok(())
}

fn take_ready_buffered_success_responses(
    buffered_success_responses: &mut VecDeque<BufferedSuccessResponse>,
) -> Vec<BufferedSuccessResponse> {
    let mut ready_responses = Vec::new();
    while buffered_success_responses
        .front()
        .is_some_and(|buffered_success_response| {
            buffered_success_response
                .subscription_retention_result
                .is_some()
        })
    {
        ready_responses.push(
            buffered_success_responses
                .pop_front()
                .expect("front buffered success response should exist"),
        );
    }

    ready_responses
}

fn clone_retention_result(
    result: &Result<(), CodexSessionManagerError>,
) -> Result<(), CodexSessionManagerError> {
    match result {
        Ok(()) => Ok(()),
        Err(CodexSessionManagerError::CommandChannelClosed) => {
            Err(CodexSessionManagerError::CommandChannelClosed)
        }
        Err(CodexSessionManagerError::RequestRejected { method, message }) => {
            Err(CodexSessionManagerError::RequestRejected {
                method,
                message: message.clone(),
            })
        }
        Err(CodexSessionManagerError::RequestFailed { method, message }) => {
            Err(CodexSessionManagerError::RequestFailed {
                method,
                message: message.clone(),
            })
        }
    }
}

#[cfg(test)]
mod tests;
