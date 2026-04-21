use std::collections::{BTreeMap, VecDeque};
use std::io::ErrorKind;
use std::sync::OnceLock;

use futures_util::{SinkExt, StreamExt};
use opentelemetry::Context as OtelContext;
use opentelemetry::propagation::{Extractor, TextMapCompositePropagator, TextMapPropagator};
use opentelemetry_sdk::propagation::{BaggagePropagator, TraceContextPropagator};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{accept_async, connect_async};
use tracing::{field, info, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tungstenite::Message;

use crate::codex_proxy::types::{
    BufferedSuccessResponse, DeliveryContext, DeliveryContextPayload, PendingClientRequest,
    ProxyClientKind,
};
use crate::codex_proxy::{
    CodexProxyError, CodexSessionManagerError, CodexSessionManagerHandle,
    MISTLE_AGENT_CLIENT_TITLE, RetainReason, is_connection_termination_error,
};
const SET_DELIVERY_CONTEXT_METHOD: &str = "mistle/setDeliveryContext";
const TURN_START_METHOD: &str = "turn/start";
const TURN_STEER_METHOD: &str = "turn/steer";
const RETENTION_FAILURE_ERROR_CODE: i64 = -32000;
const RETENTION_FAILURE_ERROR_MESSAGE: &str =
    "sandboxd failed to retain Codex thread subscription for background execution";

struct RetentionResult {
    request_key: String,
    result: Result<(), CodexSessionManagerError>,
}

struct MatchedRetentionTarget {
    request_key: String,
    thread_id: String,
    turn_id: String,
    delivery_context: Option<DeliveryContext>,
}

static DELIVERY_CONTEXT_PROPAGATOR: OnceLock<TextMapCompositePropagator> = OnceLock::new();

fn read_trace_id(traceparent: &str) -> Option<&str> {
    let mut parts = traceparent.split('-');
    let _version = parts.next()?;
    let trace_id = parts.next()?;
    let _parent_span_id = parts.next()?;
    let _trace_flags = parts.next()?;
    if parts.next().is_some() || trace_id.len() != 32 {
        return None;
    }

    Some(trace_id)
}

fn delivery_trace_id(delivery_context: &DeliveryContext) -> &str {
    read_trace_id(delivery_context.traceparent.as_str()).unwrap_or("unknown")
}

fn start_delivery_proxy_span(
    method: &str,
    delivery_context: &DeliveryContext,
    thread_id: Option<&str>,
) -> tracing::Span {
    let delivery_span = info_span!(
        "sandboxd.codex_proxy.delivery_request",
        "otel.trace_id" = %delivery_trace_id(delivery_context),
        "mistle.traceparent" = %delivery_context.traceparent,
        "mistle.webhook_event_id" = %delivery_context.webhook_event_id,
        "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
        "mistle.automation_run_id" = %delivery_context.automation_run_id,
        "mistle.conversation_id" = %delivery_context.conversation_id,
        "mistle.sandbox_instance_id" = %delivery_context.sandbox_instance_id,
        "mistle.route_id" = field::display(delivery_context.route_id.as_deref().unwrap_or("")),
        "rpc.method" = %method,
        "thread.id" = field::display(thread_id.unwrap_or("")),
    );
    let _ = delivery_span.set_parent(extract_delivery_parent_context(delivery_context));
    delivery_span
}

fn log_delivery_context_received(delivery_context: &DeliveryContext) {
    info!(
        event = "codex_proxy.delivery_context.received",
        "otel.trace_id" = %delivery_trace_id(delivery_context),
        "mistle.traceparent" = %delivery_context.traceparent,
        "mistle.webhook_event_id" = %delivery_context.webhook_event_id,
        "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
        "mistle.automation_run_id" = %delivery_context.automation_run_id,
        "mistle.conversation_id" = %delivery_context.conversation_id,
        "mistle.sandbox_instance_id" = %delivery_context.sandbox_instance_id,
        "mistle.route_id" = field::display(delivery_context.route_id.as_deref().unwrap_or("")),
        "mistle.external_delivery_id" =
            field::display(delivery_context.external_delivery_id.as_deref().unwrap_or("")),
        "mistle.tracestate" = field::display(delivery_context.tracestate.as_deref().unwrap_or("")),
        "mistle.baggage" = field::display(delivery_context.baggage.as_deref().unwrap_or("")),
        "rpc.method" = SET_DELIVERY_CONTEXT_METHOD,
        "sandboxd.codex_proxy.delivery_context" = "updated",
    );
}

fn log_delivery_context_mapping(
    delivery_context: &DeliveryContext,
    thread_id: &str,
    turn_id: &str,
) {
    info!(
        event = "codex_proxy.delivery_context.mapped",
        "otel.trace_id" = %delivery_trace_id(delivery_context),
        "mistle.traceparent" = %delivery_context.traceparent,
        "mistle.webhook_event_id" = %delivery_context.webhook_event_id,
        "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
        "mistle.automation_run_id" = %delivery_context.automation_run_id,
        "mistle.conversation_id" = %delivery_context.conversation_id,
        "mistle.sandbox_instance_id" = %delivery_context.sandbox_instance_id,
        "mistle.route_id" = field::display(delivery_context.route_id.as_deref().unwrap_or("")),
        "thread.id" = %thread_id,
        "turn.id" = %turn_id,
    );
}

struct DeliveryContextExtractor<'a> {
    delivery_context: &'a DeliveryContext,
}

impl Extractor for DeliveryContextExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        match key {
            "traceparent" => Some(self.delivery_context.traceparent.as_str()),
            "tracestate" => self.delivery_context.tracestate.as_deref(),
            "baggage" => self.delivery_context.baggage.as_deref(),
            _ => None,
        }
    }

    fn keys(&self) -> Vec<&str> {
        let mut keys = vec!["traceparent"];
        if self.delivery_context.tracestate.is_some() {
            keys.push("tracestate");
        }
        if self.delivery_context.baggage.is_some() {
            keys.push("baggage");
        }

        keys
    }
}

fn extract_delivery_parent_context(delivery_context: &DeliveryContext) -> OtelContext {
    DELIVERY_CONTEXT_PROPAGATOR
        .get_or_init(|| {
            TextMapCompositePropagator::new(vec![
                Box::new(TraceContextPropagator::new()),
                Box::new(BaggagePropagator::new()),
            ])
        })
        .extract(&DeliveryContextExtractor { delivery_context })
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
    let mut buffered_success_responses = VecDeque::<BufferedSuccessResponse>::new();
    let mut next_response_sequence = 0_u64;

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => return Ok(()),
            retention_result = retention_result_receiver.recv() => {
                if let Some(retention_result) = retention_result {
                    record_retention_result(&retention_result, &mut buffered_success_responses);
                } else {
                    return Ok(());
                }
            }
            client_message = client_socket.next() => {
                match client_message {
                    Some(Ok(message)) => {
                        if let Message::Close(frame) = message {
                            raw_socket
                                .send(Message::Close(frame))
                                .await
                                .map_err(CodexProxyError::WriteSocket)?;
                            return Ok(());
                        }

                        if should_forward_client_message(
                            &message,
                            &mut client_kind,
                            &mut current_delivery_context,
                            &mut pending_requests,
                        )? {
                            raw_socket
                                .send(message)
                                .await
                                .map_err(CodexProxyError::WriteSocket)?;
                        }
                    }
                    Some(Err(error)) if is_connection_termination_error(&error) => return Ok(()),
                    Some(Err(error)) => return Err(CodexProxyError::ReadSocket(error)),
                    None => return Ok(()),
                }
            }
            raw_message = raw_socket.next() => {
                match raw_message {
                    Some(Ok(message)) => {
                        if let Message::Close(frame) = message {
                            client_socket
                                .send(Message::Close(frame))
                                .await
                                .map_err(CodexProxyError::WriteSocket)?;
                            return Ok(());
                        }

                        if let Some(retention_target) =
                            matched_retention_target(&message, &client_kind, &mut pending_requests)?
                        {
                            if let Some(delivery_context) = retention_target.delivery_context.clone()
                            {
                                thread_delivery_contexts
                                    .insert(retention_target.thread_id.clone(), delivery_context.clone());
                                turn_delivery_contexts
                                    .insert(retention_target.turn_id.clone(), delivery_context);
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
                        } else {
                            client_socket
                                .send(message)
                                .await
                                .map_err(CodexProxyError::WriteSocket)?;
                        }
                    }
                    Some(Err(error)) if is_connection_termination_error(&error) => return Ok(()),
                    Some(Err(error)) => return Err(CodexProxyError::ReadSocket(error)),
                    None => return Ok(()),
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
    pending_requests: &mut BTreeMap<String, PendingClientRequest>,
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
        TURN_START_METHOD | TURN_STEER_METHOD => value["params"]["threadId"]
            .as_str()
            .map(ToString::to_string),
        _ => None,
    };
    pending_requests.insert(
        request_key,
        PendingClientRequest {
            method: method.to_string(),
            thread_id: thread_id.clone(),
            delivery_context: current_delivery_context.clone(),
        },
    );

    if let Some(delivery_context) = current_delivery_context.as_ref() {
        let delivery_span =
            start_delivery_proxy_span(method, delivery_context, thread_id.as_deref());
        let _entered = delivery_span.enter();
        info!(
            event = "codex_proxy.delivery_request.forwarded",
            "otel.trace_id" = %delivery_trace_id(delivery_context),
            "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
            "mistle.webhook_event_id" = %delivery_context.webhook_event_id,
            "rpc.method" = %method,
            "thread.id" = field::display(thread_id.as_deref().unwrap_or("")),
        );
    }

    Ok(true)
}

fn matched_retention_target(
    message: &Message,
    client_kind: &ProxyClientKind,
    pending_requests: &mut BTreeMap<String, PendingClientRequest>,
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

    if *client_kind != ProxyClientKind::MistleAgentClient {
        return Ok(None);
    }
    if value.get("error").is_some() {
        return Ok(None);
    }

    let Some(thread_id) = pending_request.thread_id else {
        return Ok(None);
    };
    let turn_id = match pending_request.method.as_str() {
        TURN_START_METHOD => value["result"]["turn"]["id"]
            .as_str()
            .map(ToString::to_string),
        TURN_STEER_METHOD => value["result"]["turnId"].as_str().map(ToString::to_string),
        _ => None,
    };
    let Some(turn_id) = turn_id else {
        return Ok(None);
    };

    Ok(Some(MatchedRetentionTarget {
        request_key,
        thread_id,
        turn_id,
        delivery_context: pending_request.delivery_context,
    }))
}

fn parse_delivery_context_payload(value: &Value) -> Result<DeliveryContext, CodexProxyError> {
    let payload = serde_json::from_value::<DeliveryContextPayload>(
        value.get("params").cloned().unwrap_or(Value::Null),
    )
    .map_err(CodexProxyError::InvalidJson)?;
    Ok(payload.into())
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

fn parse_json_value_from_message(message: &Message) -> Result<Option<Value>, CodexProxyError> {
    let Message::Text(payload) = message else {
        return Ok(None);
    };
    let value = serde_json::from_str(payload.as_str()).map_err(CodexProxyError::InvalidJson)?;
    Ok(Some(value))
}

fn parse_json_rpc_id_from_message(message: &Message) -> Result<Value, CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Err(CodexProxyError::InvalidJson(serde_json::Error::io(
            std::io::Error::new(
                ErrorKind::InvalidData,
                "Codex proxy expected a JSON-RPC text message with an id",
            ),
        )));
    };

    value.get("id").cloned().ok_or_else(|| {
        CodexProxyError::InvalidJson(serde_json::Error::io(std::io::Error::new(
            ErrorKind::InvalidData,
            "Codex proxy expected a JSON-RPC message id",
        )))
    })
}

fn json_rpc_id_key(request_id: &Value) -> Option<String> {
    match request_id {
        Value::Null => None,
        _ => Some(request_id.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::io;
    use std::sync::{Arc, Mutex};

    use opentelemetry::trace::{TraceContextExt, TracerProvider as _};
    use opentelemetry_sdk::trace::SdkTracerProvider;
    use serde_json::json;
    use tracing::info;
    use tracing_opentelemetry::OpenTelemetrySpanExt;
    use tracing_subscriber::layer::SubscriberExt;
    use tungstenite::Message;

    use crate::codex_proxy::CodexSessionManagerError;
    use crate::codex_proxy::types::{
        BufferedSuccessResponse, DeliveryContext, PendingClientRequest, ProxyClientKind,
    };

    use super::{
        log_delivery_context_mapping, matched_retention_target, should_forward_client_message,
        start_delivery_proxy_span, take_ready_buffered_success_responses,
    };

    #[derive(Clone, Default)]
    struct SharedLogWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    struct SharedLogWriterHandle {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl SharedLogWriter {
        fn contents(&self) -> String {
            let bytes = self
                .buffer
                .lock()
                .expect("shared log buffer should not be poisoned")
                .clone();
            String::from_utf8(bytes).expect("shared log buffer should contain utf8")
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for SharedLogWriter {
        type Writer = SharedLogWriterHandle;

        fn make_writer(&'a self) -> Self::Writer {
            SharedLogWriterHandle {
                buffer: self.buffer.clone(),
            }
        }
    }

    impl io::Write for SharedLogWriterHandle {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.buffer
                .lock()
                .expect("shared log buffer should not be poisoned")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn test_delivery_context() -> DeliveryContext {
        DeliveryContext {
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: Some("vendor=value".to_string()),
            baggage: Some("automation=webhook".to_string()),
            webhook_event_id: "iwe_123".to_string(),
            delivery_task_id: "cdt_123".to_string(),
            external_delivery_id: Some("slack_delivery_123".to_string()),
            automation_run_id: "aru_123".to_string(),
            conversation_id: "acv_123".to_string(),
            sandbox_instance_id: "sbi_123".to_string(),
            route_id: Some("acr_123".to_string()),
        }
    }

    #[test]
    fn classifies_mistle_agent_client_initialize_requests() {
        let mut client_kind = ProxyClientKind::Unknown;
        let mut current_delivery_context = None;
        let mut pending_requests = std::collections::BTreeMap::new();

        let should_forward = should_forward_client_message(
            &Message::Text(
                json!({
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "clientInfo": {
                            "name": "codex_cli_rs",
                            "title": "Mistle Agent Client",
                            "version": "0.1.0"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut client_kind,
            &mut current_delivery_context,
            &mut pending_requests,
        )
        .expect("initialize request should parse");

        assert!(should_forward);
        assert_eq!(client_kind, ProxyClientKind::MistleAgentClient);
    }

    #[test]
    fn intercepts_delivery_context_notifications_and_stores_context() {
        let mut client_kind = ProxyClientKind::MistleAgentClient;
        let mut current_delivery_context = None;
        let mut pending_requests = std::collections::BTreeMap::new();

        let should_forward = should_forward_client_message(
            &Message::Text(
                json!({
                    "method": "mistle/setDeliveryContext",
                    "params": {
                        "traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
                        "webhookEventId": "iwe_123",
                        "deliveryTaskId": "cdt_123",
                        "automationRunId": "aru_123",
                        "conversationId": "acv_123",
                        "sandboxInstanceId": "sbi_123"
                    }
                })
                .to_string()
                .into(),
            ),
            &mut client_kind,
            &mut current_delivery_context,
            &mut pending_requests,
        )
        .expect("delivery context notification should parse");

        assert!(!should_forward);
        assert!(pending_requests.is_empty());
        assert_eq!(
            current_delivery_context,
            Some(DeliveryContext {
                traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
                tracestate: None,
                baggage: None,
                webhook_event_id: "iwe_123".to_string(),
                delivery_task_id: "cdt_123".to_string(),
                external_delivery_id: None,
                automation_run_id: "aru_123".to_string(),
                conversation_id: "acv_123".to_string(),
                sandbox_instance_id: "sbi_123".to_string(),
                route_id: None,
            })
        );
    }

    #[test]
    fn matches_turn_steer_success_for_retention() {
        let mut pending_requests = std::collections::BTreeMap::from([(
            "17".to_string(),
            PendingClientRequest {
                method: "turn/steer".to_string(),
                thread_id: Some("thr_123".to_string()),
                delivery_context: Some(test_delivery_context()),
            },
        )]);

        let matched = matched_retention_target(
            &Message::Text(
                json!({
                    "id": 17,
                    "result": {
                        "turnId": "turn_123"
                    }
                })
                .to_string()
                .into(),
            ),
            &ProxyClientKind::MistleAgentClient,
            &mut pending_requests,
        )
        .expect("turn/steer response should parse");

        let matched = matched.expect("turn/steer response should match retention target");
        assert_eq!(matched.request_key, "17");
        assert_eq!(matched.thread_id, "thr_123");
        assert_eq!(matched.turn_id, "turn_123");
        assert_eq!(
            matched
                .delivery_context
                .map(|context| context.delivery_task_id),
            Some("cdt_123".to_string())
        );
    }

    #[test]
    fn delivery_proxy_spans_join_parent_trace_and_logs_expose_delivery_mapping() {
        let log_writer = SharedLogWriter::default();
        let tracer_provider = SdkTracerProvider::default();
        let tracer = tracer_provider.tracer("sandboxd-test");
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .with(
                tracing_subscriber::fmt::layer()
                    .without_time()
                    .with_target(false)
                    .with_writer(log_writer.clone()),
            );
        let delivery_context = test_delivery_context();

        tracing::subscriber::with_default(subscriber, || {
            let delivery_span =
                start_delivery_proxy_span("turn/start", &delivery_context, Some("thr_123"));
            let span_context = delivery_span.context();
            let _entered = delivery_span.enter();
            info!(event = "codex_proxy.test.forwarded");
            log_delivery_context_mapping(&delivery_context, "thr_123", "turn_123");

            assert_eq!(
                span_context.span().span_context().trace_id().to_string(),
                "0123456789abcdef0123456789abcdef"
            );
        });

        let output = log_writer.contents();
        assert!(output.contains("cdt_123"));
        assert!(output.contains("iwe_123"));
        assert!(output.contains("thr_123"));
        assert!(output.contains("turn_123"));
        assert!(output.contains("0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn ready_responses_flush_only_from_the_head_of_the_queue() {
        let mut buffered_success_responses = VecDeque::from([
            BufferedSuccessResponse {
                request_id: json!(1),
                response_sequence: 1,
                payload: Message::Text("{\"id\":1}".to_string().into()),
                subscription_retention_result: None,
            },
            BufferedSuccessResponse {
                request_id: json!(2),
                response_sequence: 2,
                payload: Message::Text("{\"id\":2}".to_string().into()),
                subscription_retention_result: Some(Err(
                    CodexSessionManagerError::CommandChannelClosed,
                )),
            },
        ]);

        assert!(take_ready_buffered_success_responses(&mut buffered_success_responses).is_empty());
        assert_eq!(buffered_success_responses.len(), 2);

        buffered_success_responses[0].subscription_retention_result = Some(Ok(()));

        let ready_responses =
            take_ready_buffered_success_responses(&mut buffered_success_responses);
        assert_eq!(ready_responses.len(), 2);
        assert_eq!(ready_responses[0].request_id, json!(1));
        assert_eq!(ready_responses[1].request_id, json!(2));
        assert!(buffered_success_responses.is_empty());
    }
}
