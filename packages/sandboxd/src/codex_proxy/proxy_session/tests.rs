use std::collections::VecDeque;
use std::io;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use opentelemetry::trace::{TraceContextExt, TracerProvider as _};
use opentelemetry_sdk::trace::SdkTracerProvider;
use serde_json::json;
use tracing::info;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::layer::SubscriberExt;
use tungstenite::Message;

use crate::codex_proxy::types::DeliveryContextSource;

use crate::codex_proxy::CodexSessionManagerError;
use crate::codex_proxy::types::{
    BufferedSuccessResponse, DeliveryContext, PendingClientRequest, ProxyClientKind,
};

use crate::codex_proxy::proxy_session::activity::{
    ActiveCompactionState, ActiveTurnState, ClientForwardContext, PendingCompactionRequest,
    TurnRequestKind, finalize_active_compactions_for_transport_outcome,
    finalize_active_turns_for_transport_outcome,
    finalize_unresolved_compactions_for_transport_outcome, log_delivery_context_mapping,
    observe_server_notification, start_delivery_proxy_span, start_thread_compaction_span,
    start_turn_lifecycle_span,
};
use crate::codex_proxy::proxy_session::{
    matched_retention_target, should_forward_client_message, take_ready_buffered_success_responses,
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
        strip_ansi_escape_codes(
            &String::from_utf8(bytes).expect("shared log buffer should contain utf8"),
        )
    }
}

fn strip_ansi_escape_codes(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && matches!(chars.peek(), Some('[')) {
            let _ = chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }

        output.push(ch);
    }
    output
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

fn assert_log_field(output: &str, key: &str, value: &str) {
    let unquoted = format!("{key}={value}");
    let quoted = format!("{key}=\"{value}\"");
    assert!(
        output.contains(&unquoted) || output.contains(&quoted),
        "expected log output to contain '{unquoted}' or '{quoted}', got: {output}"
    );
}

fn test_delivery_context() -> DeliveryContext {
    DeliveryContext {
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
        tracestate: Some("vendor=value".to_string()),
        baggage: Some("trigger=webhook".to_string()),
        source: DeliveryContextSource::Webhook,
        webhook_event_id: Some("iwe_123".to_string()),
        scheduled_action_id: None,
        delivery_task_id: "cdt_123".to_string(),
        external_delivery_id: Some("slack_delivery_123".to_string()),
        trigger_run_id: "aru_123".to_string(),
        conversation_id: "acv_123".to_string(),
        sandbox_instance_id: "sbi_123".to_string(),
        route_id: Some("acr_123".to_string()),
    }
}

#[test]
fn classifies_mistle_agent_client_initialize_requests() {
    let mut client_kind = ProxyClientKind::Unknown;
    let mut current_delivery_context = None;
    let mut pending_compaction_requests = std::collections::BTreeMap::new();
    let mut pending_requests = std::collections::BTreeMap::new();
    let mut active_turns = std::collections::BTreeMap::new();

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
        &mut ClientForwardContext {
            thread_delivery_contexts: &std::collections::BTreeMap::new(),
            turn_delivery_contexts: &std::collections::BTreeMap::new(),
            active_turns: &mut active_turns,
            pending_compaction_requests: &mut pending_compaction_requests,
            pending_requests: &mut pending_requests,
        },
    )
    .expect("initialize request should parse");

    assert!(should_forward);
    assert_eq!(client_kind, ProxyClientKind::MistleAgentClient);
}

#[test]
fn intercepts_delivery_context_notifications_and_stores_context() {
    let mut client_kind = ProxyClientKind::MistleAgentClient;
    let mut current_delivery_context = None;
    let mut pending_compaction_requests = std::collections::BTreeMap::new();
    let mut pending_requests = std::collections::BTreeMap::new();
    let mut active_turns = std::collections::BTreeMap::new();

    let should_forward = should_forward_client_message(
        &Message::Text(
            json!({
                "method": "mistle/setDeliveryContext",
                "params": {
                    "traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
                    "source": "webhook",
                    "webhookEventId": "iwe_123",
                    "deliveryTaskId": "cdt_123",
                    "triggerRunId": "aru_123",
                    "conversationId": "acv_123",
                    "sandboxInstanceId": "sbi_123"
                }
            })
            .to_string()
            .into(),
        ),
        &mut client_kind,
        &mut current_delivery_context,
        &mut ClientForwardContext {
            thread_delivery_contexts: &std::collections::BTreeMap::new(),
            turn_delivery_contexts: &std::collections::BTreeMap::new(),
            active_turns: &mut active_turns,
            pending_compaction_requests: &mut pending_compaction_requests,
            pending_requests: &mut pending_requests,
        },
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
            source: DeliveryContextSource::Webhook,
            webhook_event_id: Some("iwe_123".to_string()),
            scheduled_action_id: None,
            delivery_task_id: "cdt_123".to_string(),
            external_delivery_id: None,
            trigger_run_id: "aru_123".to_string(),
            conversation_id: "acv_123".to_string(),
            sandbox_instance_id: "sbi_123".to_string(),
            route_id: None,
        })
    );
}

#[test]
fn intercepts_schedule_delivery_context_notifications_and_stores_context() {
    let mut client_kind = ProxyClientKind::MistleAgentClient;
    let mut current_delivery_context = None;
    let mut pending_compaction_requests = std::collections::BTreeMap::new();
    let mut pending_requests = std::collections::BTreeMap::new();
    let mut active_turns = std::collections::BTreeMap::new();

    let should_forward = should_forward_client_message(
        &Message::Text(
            json!({
                "method": "mistle/setDeliveryContext",
                "params": {
                    "traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
                    "source": "schedule",
                    "scheduledActionId": "sca_123",
                    "deliveryTaskId": "cdt_123",
                    "triggerRunId": "aru_123",
                    "conversationId": "acv_123",
                    "sandboxInstanceId": "sbi_123"
                }
            })
            .to_string()
            .into(),
        ),
        &mut client_kind,
        &mut current_delivery_context,
        &mut ClientForwardContext {
            thread_delivery_contexts: &std::collections::BTreeMap::new(),
            turn_delivery_contexts: &std::collections::BTreeMap::new(),
            active_turns: &mut active_turns,
            pending_compaction_requests: &mut pending_compaction_requests,
            pending_requests: &mut pending_requests,
        },
    )
    .expect("schedule delivery context notification should parse");

    assert!(!should_forward);
    assert!(pending_requests.is_empty());
    assert_eq!(
        current_delivery_context,
        Some(DeliveryContext {
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
            baggage: None,
            source: DeliveryContextSource::Schedule,
            webhook_event_id: None,
            scheduled_action_id: Some("sca_123".to_string()),
            delivery_task_id: "cdt_123".to_string(),
            external_delivery_id: None,
            trigger_run_id: "aru_123".to_string(),
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
            expected_turn_id: Some("turn_122".to_string()),
            interruption_source: None,
            interruption_expected: None,
            compaction_trigger: None,
            request_started_at: Instant::now(),
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
        &mut std::collections::BTreeMap::new(),
    )
    .expect("turn/steer response should parse");

    let matched = matched.expect("turn/steer response should match retention target");
    assert_eq!(matched.request_key, "17");
    assert_eq!(matched.thread_id, "thr_123");
    assert_eq!(matched.turn_id, "turn_123");
    assert_eq!(matched.request_kind, TurnRequestKind::Steer);
    assert_eq!(matched.expected_turn_id.as_deref(), Some("turn_122"));
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

fn test_active_turn(request_kind: TurnRequestKind) -> ActiveTurnState {
    let delivery_context = test_delivery_context();
    let thread_id = "thr_123".to_string();
    let turn_id = "turn_123".to_string();
    let expected_turn_id = Some("turn_122".to_string());
    ActiveTurnState {
        span: start_turn_lifecycle_span(
            request_kind,
            &delivery_context,
            thread_id.as_str(),
            turn_id.as_str(),
            expected_turn_id.as_deref(),
        ),
        delivery_context,
        thread_id,
        turn_id,
        expected_turn_id,
        request_kind,
        request_started_at: Instant::now(),
        started_at: None,
        first_item_at: None,
        first_item_type: None,
        interruption_source: None,
        interruption_expected: None,
    }
}

fn test_active_compaction(trigger: &str) -> ActiveCompactionState {
    let delivery_context = Some(test_delivery_context());
    ActiveCompactionState {
        span: start_thread_compaction_span(
            delivery_context.as_ref(),
            "thr_123",
            "turn_123",
            trigger,
            "started",
        ),
        delivery_context,
        thread_id: "thr_123".to_string(),
        turn_id: "turn_123".to_string(),
        requested_at: Some(Instant::now()),
        started_at: Instant::now(),
        trigger: trigger.to_string(),
    }
}

#[test]
fn records_turn_lifecycle_from_started_to_completed() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut active_turns = std::collections::BTreeMap::from([(
            "turn_123".to_string(),
            test_active_turn(TurnRequestKind::Start),
        )]);

        observe_server_notification(
            &Message::Text(
                json!({
                    "method": "turn/started",
                    "params": {
                        "turn": {
                            "id": "turn_123"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut active_turns,
            &std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
        )
        .expect("turn/started should parse");
        observe_server_notification(
            &Message::Text(
                json!({
                    "method": "item/started",
                    "params": {
                        "turn": {
                            "id": "turn_123"
                        },
                        "item": {
                            "type": "contextCompaction"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut active_turns,
            &std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
        )
        .expect("item/started should parse");
        observe_server_notification(
            &Message::Text(
                json!({
                    "method": "turn/completed",
                    "params": {
                        "turn": {
                            "id": "turn_123",
                            "status": "completed"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut active_turns,
            &std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
        )
        .expect("turn/completed should parse");

        assert!(active_turns.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.started"));
    assert!(output.contains("codex_proxy.turn.first_item"));
    assert!(output.contains("contextCompaction"));
    assert!(output.contains("codex_proxy.turn.completed"));
    assert_log_field(&output, "outcome", "completed");
    assert_log_field(&output, "deliveryTaskId", "cdt_123");
}

#[test]
fn classifies_failed_turns_before_first_item() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut active_turns = std::collections::BTreeMap::from([(
            "turn_123".to_string(),
            test_active_turn(TurnRequestKind::Steer),
        )]);

        observe_server_notification(
            &Message::Text(
                json!({
                    "method": "turn/completed",
                    "params": {
                        "turn": {
                            "id": "turn_123",
                            "status": "failed"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut active_turns,
            &std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
        )
        .expect("turn/completed should parse");

        assert!(active_turns.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.completed"));
    assert_log_field(&output, "outcome", "failed");
    assert_log_field(&output, "reason", "failed_before_first_item");
    assert_log_field(&output, "mistle.turn.request_kind", "turn_steer");
}

#[test]
fn classifies_transport_reset_for_unfinished_turns() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut active_turns = std::collections::BTreeMap::from([(
            "turn_123".to_string(),
            test_active_turn(TurnRequestKind::Start),
        )]);

        finalize_active_turns_for_transport_outcome(&mut active_turns, "reset", "raw_socket_error");

        assert!(active_turns.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.transport_ended"));
    assert!(output.contains("codex_proxy.turn.interrupted"));
    assert!(output.contains("codex_proxy.turn.stalled"));
    assert_log_field(&output, "outcome", "reset");
    assert_log_field(&output, "outcome", "stalled");
    assert_log_field(&output, "reason", "raw_socket_error");
    assert_log_field(&output, "interruptionSource", "session_reset");
}

#[test]
fn distinguishes_started_without_output_when_transport_ends() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut active_turn = test_active_turn(TurnRequestKind::Start);
        active_turn.started_at = Some(Instant::now());
        let mut active_turns =
            std::collections::BTreeMap::from([("turn_123".to_string(), active_turn)]);

        finalize_active_turns_for_transport_outcome(&mut active_turns, "reset", "raw_socket_error");

        assert!(active_turns.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.transport_ended"));
    assert_log_field(&output, "reason", "started_but_no_output");
    assert_log_field(&output, "interruptionSource", "session_reset");
}

#[test]
fn logs_failed_turn_request_responses_with_delivery_context() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut pending_requests = std::collections::BTreeMap::from([(
            "17".to_string(),
            PendingClientRequest {
                method: "turn/start".to_string(),
                thread_id: Some("thr_123".to_string()),
                expected_turn_id: None,
                interruption_source: None,
                interruption_expected: None,
                compaction_trigger: None,
                request_started_at: Instant::now(),
                delivery_context: Some(test_delivery_context()),
            },
        )]);

        let matched = matched_retention_target(
            &Message::Text(
                json!({
                    "id": 17,
                    "error": {
                        "code": -32001,
                        "message": "turn rejected"
                    }
                })
                .to_string()
                .into(),
            ),
            &ProxyClientKind::MistleAgentClient,
            &mut pending_requests,
            &mut std::collections::BTreeMap::new(),
        )
        .expect("error response should parse");

        assert!(matched.is_none());
        assert!(pending_requests.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.request_failed"));
    assert!(output.contains("failed"));
    assert!(output.contains("turn rejected"));
    assert_log_field(&output, "deliveryTaskId", "cdt_123");
    assert_log_field(&output, "threadId", "thr_123");
}

#[test]
fn logs_manual_compaction_requests_after_successful_response() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut pending_requests = std::collections::BTreeMap::from([(
            "21".to_string(),
            PendingClientRequest {
                method: "thread/compact/start".to_string(),
                thread_id: Some("thr_123".to_string()),
                expected_turn_id: None,
                interruption_source: None,
                interruption_expected: None,
                compaction_trigger: Some("manual".to_string()),
                request_started_at: Instant::now(),
                delivery_context: Some(test_delivery_context()),
            },
        )]);
        let mut pending_compaction_requests = std::collections::BTreeMap::new();

        let matched = matched_retention_target(
            &Message::Text(
                json!({
                    "id": 21,
                    "result": {}
                })
                .to_string()
                .into(),
            ),
            &ProxyClientKind::Other,
            &mut pending_requests,
            &mut pending_compaction_requests,
        )
        .expect("thread/compact/start response should parse");

        assert!(matched.is_none());
        assert_eq!(
            pending_compaction_requests
                .get("thr_123")
                .map(|request| request.trigger.as_str()),
            Some("manual")
        );
    });

    let output = log_writer.contents();
    assert!(output.contains("codex.thread.compaction_requested"));
    assert!(output.contains("requested"));
    assert_log_field(&output, "compactionTrigger", "manual");
    assert!(output.contains("accepted"));
}

#[test]
fn classifies_automatic_context_compaction_from_item_notifications() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut active_turns = std::collections::BTreeMap::new();
        let thread_delivery_contexts =
            std::collections::BTreeMap::from([("thr_123".to_string(), test_delivery_context())]);
        let mut pending_compaction_requests = std::collections::BTreeMap::new();
        let mut active_compactions = std::collections::BTreeMap::new();

        observe_server_notification(
            &Message::Text(
                json!({
                    "method": "item/started",
                    "params": {
                        "threadId": "thr_123",
                        "turnId": "turn_123",
                        "item": {
                            "id": "cmp_123",
                            "type": "contextCompaction"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut active_turns,
            &thread_delivery_contexts,
            &mut pending_compaction_requests,
            &mut active_compactions,
        )
        .expect("contextCompaction item/started should parse");

        observe_server_notification(
            &Message::Text(
                json!({
                    "method": "item/completed",
                    "params": {
                        "threadId": "thr_123",
                        "turnId": "turn_123",
                        "item": {
                            "id": "cmp_123",
                            "type": "contextCompaction"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut active_turns,
            &thread_delivery_contexts,
            &mut pending_compaction_requests,
            &mut active_compactions,
        )
        .expect("contextCompaction item/completed should parse");

        assert!(active_compactions.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex.thread.compaction_started"));
    assert!(output.contains("codex.thread.compaction_completed"));
    assert_log_field(&output, "compactionTrigger", "automatic");
    assert!(output.contains("compacted"));
}

#[test]
fn classifies_unknown_terminal_compaction_when_transport_ends() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut active_compactions = std::collections::BTreeMap::from([(
            "cmp_123".to_string(),
            test_active_compaction("manual"),
        )]);

        finalize_active_compactions_for_transport_outcome(
            &mut active_compactions,
            "raw_socket_error",
        );

        assert!(active_compactions.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex.thread.compaction_unknown_terminal_outcome"));
    assert_log_field(&output, "compactionState", "unknown_terminal_outcome");
    assert_log_field(&output, "compactionTrigger", "manual");
    assert_log_field(&output, "reason", "raw_socket_error");
}

#[test]
fn classifies_pending_manual_compaction_as_unknown_when_transport_ends() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut pending_compaction_requests = std::collections::BTreeMap::from([(
            "thr_123".to_string(),
            PendingCompactionRequest {
                delivery_context: Some(test_delivery_context()),
                requested_at: Instant::now(),
                trigger: "manual".to_string(),
            },
        )]);
        let mut active_compactions = std::collections::BTreeMap::new();

        finalize_unresolved_compactions_for_transport_outcome(
            &mut pending_compaction_requests,
            &mut active_compactions,
            "raw_socket_error",
        );

        assert!(pending_compaction_requests.is_empty());
        assert!(active_compactions.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex.thread.compaction_unknown_terminal_outcome"));
    assert_log_field(&output, "compactionTrigger", "manual");
    assert_log_field(&output, "reason", "raw_socket_error");
}

#[test]
fn classifies_superseded_pending_manual_compaction_as_unknown() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut client_kind = ProxyClientKind::Other;
        let mut current_delivery_context = None;
        let mut active_turns = std::collections::BTreeMap::new();
        let mut pending_compaction_requests = std::collections::BTreeMap::from([(
            "thr_123".to_string(),
            PendingCompactionRequest {
                delivery_context: Some(test_delivery_context()),
                requested_at: Instant::now(),
                trigger: "manual".to_string(),
            },
        )]);
        let mut pending_requests = std::collections::BTreeMap::new();

        let should_forward = should_forward_client_message(
            &Message::Text(
                json!({
                    "id": 22,
                    "method": "thread/compact/start",
                    "params": {
                        "threadId": "thr_123"
                    }
                })
                .to_string()
                .into(),
            ),
            &mut client_kind,
            &mut current_delivery_context,
            &mut ClientForwardContext {
                thread_delivery_contexts: &std::collections::BTreeMap::new(),
                turn_delivery_contexts: &std::collections::BTreeMap::new(),
                active_turns: &mut active_turns,
                pending_compaction_requests: &mut pending_compaction_requests,
                pending_requests: &mut pending_requests,
            },
        )
        .expect("thread/compact/start should parse");

        assert!(should_forward);
        assert!(pending_compaction_requests.is_empty());
        assert!(pending_requests.contains_key("22"));
    });

    let output = log_writer.contents();
    assert!(output.contains("codex.thread.compaction_unknown_terminal_outcome"));
    assert_log_field(&output, "reason", "superseded_by_new_request");
    assert_log_field(&output, "compactionTrigger", "manual");
}

#[test]
fn classifies_manual_user_interrupt_requests() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut client_kind = ProxyClientKind::Other;
        let mut current_delivery_context = None;
        let thread_delivery_contexts =
            std::collections::BTreeMap::from([("thr_123".to_string(), test_delivery_context())]);
        let turn_delivery_contexts =
            std::collections::BTreeMap::from([("turn_123".to_string(), test_delivery_context())]);
        let mut active_turns = std::collections::BTreeMap::from([(
            "turn_123".to_string(),
            test_active_turn(TurnRequestKind::Start),
        )]);
        let mut pending_compaction_requests = std::collections::BTreeMap::new();
        let mut pending_requests = std::collections::BTreeMap::new();

        let should_forward = should_forward_client_message(
            &Message::Text(
                json!({
                    "id": 18,
                    "method": "turn/interrupt",
                    "params": {
                        "threadId": "thr_123",
                        "turnId": "turn_123"
                    }
                })
                .to_string()
                .into(),
            ),
            &mut client_kind,
            &mut current_delivery_context,
            &mut ClientForwardContext {
                thread_delivery_contexts: &thread_delivery_contexts,
                turn_delivery_contexts: &turn_delivery_contexts,
                active_turns: &mut active_turns,
                pending_compaction_requests: &mut pending_compaction_requests,
                pending_requests: &mut pending_requests,
            },
        )
        .expect("turn/interrupt should parse");

        assert!(should_forward);
        assert_eq!(
            active_turns
                .get("turn_123")
                .and_then(|active_turn| active_turn.interruption_source.as_deref()),
            Some("manual_user_interrupt")
        );
        assert_eq!(
            active_turns
                .get("turn_123")
                .and_then(|active_turn| active_turn.interruption_expected),
            Some(true)
        );
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.interrupt_requested"));
    assert_log_field(&output, "interruptionSource", "manual_user_interrupt");
    assert_log_field(&output, "interruptionExpected", "true");
}

#[test]
fn classifies_trigger_interrupt_requests() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut client_kind = ProxyClientKind::MistleAgentClient;
        let mut current_delivery_context = Some(test_delivery_context());
        let thread_delivery_contexts =
            std::collections::BTreeMap::from([("thr_123".to_string(), test_delivery_context())]);
        let turn_delivery_contexts =
            std::collections::BTreeMap::from([("turn_123".to_string(), test_delivery_context())]);
        let mut active_turns = std::collections::BTreeMap::from([(
            "turn_123".to_string(),
            test_active_turn(TurnRequestKind::Start),
        )]);
        let mut pending_compaction_requests = std::collections::BTreeMap::new();
        let mut pending_requests = std::collections::BTreeMap::new();

        let should_forward = should_forward_client_message(
            &Message::Text(
                json!({
                    "id": 19,
                    "method": "turn/interrupt",
                    "params": {
                        "threadId": "thr_123",
                        "turnId": "turn_123"
                    }
                })
                .to_string()
                .into(),
            ),
            &mut client_kind,
            &mut current_delivery_context,
            &mut ClientForwardContext {
                thread_delivery_contexts: &thread_delivery_contexts,
                turn_delivery_contexts: &turn_delivery_contexts,
                active_turns: &mut active_turns,
                pending_compaction_requests: &mut pending_compaction_requests,
                pending_requests: &mut pending_requests,
            },
        )
        .expect("turn/interrupt should parse");

        assert!(should_forward);
        assert_eq!(
            active_turns
                .get("turn_123")
                .and_then(|active_turn| active_turn.interruption_source.as_deref()),
            Some("trigger_interrupt")
        );
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.interrupt_requested"));
    assert_log_field(&output, "interruptionSource", "trigger_interrupt");
}

#[test]
fn classifies_unknown_realized_interrupts_without_prior_request() {
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

    tracing::subscriber::with_default(subscriber, || {
        let mut active_turns = std::collections::BTreeMap::from([(
            "turn_123".to_string(),
            test_active_turn(TurnRequestKind::Start),
        )]);

        observe_server_notification(
            &Message::Text(
                json!({
                    "method": "turn/completed",
                    "params": {
                        "turn": {
                            "id": "turn_123",
                            "status": "interrupted"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut active_turns,
            &std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
            &mut std::collections::BTreeMap::new(),
        )
        .expect("turn/completed should parse");

        assert!(active_turns.is_empty());
    });

    let output = log_writer.contents();
    assert!(output.contains("codex_proxy.turn.interrupted"));
    assert_log_field(&output, "interruptionSource", "unknown_interrupt");
    assert_log_field(&output, "interruptionExpected", "false");
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

    let ready_responses = take_ready_buffered_success_responses(&mut buffered_success_responses);
    assert_eq!(ready_responses.len(), 2);
    assert_eq!(ready_responses[0].request_id, json!(1));
    assert_eq!(ready_responses[1].request_id, json!(2));
    assert!(buffered_success_responses.is_empty());
}
