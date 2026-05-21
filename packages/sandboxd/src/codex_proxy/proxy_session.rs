use std::collections::{BTreeMap, VecDeque};
use std::io::ErrorKind;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use opentelemetry::trace::TraceContextExt as _;
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{accept_async, connect_async};
use tracing::{field, info, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tungstenite::Message;

use crate::codex_proxy::proxy_session::delivery_context::{
    delivery_scheduled_action_id, delivery_source, delivery_trace_id, delivery_webhook_event_id,
    extract_delivery_parent_context, optional_delivery_scheduled_action_id,
    optional_delivery_webhook_event_id, parse_delivery_context_payload,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnRequestKind {
    Start,
    Steer,
}

impl TurnRequestKind {
    fn as_log_value(self) -> &'static str {
        match self {
            Self::Start => "turn_start",
            Self::Steer => "turn_steer",
        }
    }
}

struct ActiveTurnState {
    delivery_context: DeliveryContext,
    thread_id: String,
    turn_id: String,
    expected_turn_id: Option<String>,
    request_kind: TurnRequestKind,
    request_started_at: Instant,
    started_at: Option<Instant>,
    first_item_at: Option<Instant>,
    first_item_type: Option<String>,
    interruption_source: Option<String>,
    interruption_expected: Option<bool>,
    span: tracing::Span,
}

struct PendingCompactionRequest {
    delivery_context: Option<DeliveryContext>,
    requested_at: Instant,
    trigger: String,
}

struct ActiveCompactionState {
    delivery_context: Option<DeliveryContext>,
    thread_id: String,
    turn_id: String,
    requested_at: Option<Instant>,
    started_at: Instant,
    trigger: String,
    span: tracing::Span,
}

struct ClientForwardContext<'a> {
    thread_delivery_contexts: &'a BTreeMap<String, DeliveryContext>,
    turn_delivery_contexts: &'a BTreeMap<String, DeliveryContext>,
    active_turns: &'a mut BTreeMap<String, ActiveTurnState>,
    pending_compaction_requests: &'a mut BTreeMap<String, PendingCompactionRequest>,
    pending_requests: &'a mut BTreeMap<String, PendingClientRequest>,
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
        "mistle.delivery.source" = %delivery_source(delivery_context),
        "mistle.webhook_event_id" = %delivery_webhook_event_id(delivery_context),
        "mistle.scheduled_action_id" = %delivery_scheduled_action_id(delivery_context),
        "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
        "mistle.trigger_run_id" = %delivery_context.trigger_run_id,
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
        "mistle.delivery.source" = %delivery_source(delivery_context),
        "mistle.webhook_event_id" = %delivery_webhook_event_id(delivery_context),
        "mistle.scheduled_action_id" = %delivery_scheduled_action_id(delivery_context),
        "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
        "mistle.trigger_run_id" = %delivery_context.trigger_run_id,
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
        "mistle.delivery.source" = %delivery_source(delivery_context),
        "mistle.webhook_event_id" = %delivery_webhook_event_id(delivery_context),
        "mistle.scheduled_action_id" = %delivery_scheduled_action_id(delivery_context),
        "mistle.delivery_task_id" = %delivery_context.delivery_task_id,
        "mistle.trigger_run_id" = %delivery_context.trigger_run_id,
        "mistle.conversation_id" = %delivery_context.conversation_id,
        "mistle.sandbox_instance_id" = %delivery_context.sandbox_instance_id,
        "mistle.route_id" = field::display(delivery_context.route_id.as_deref().unwrap_or("")),
        "thread.id" = %thread_id,
        "turn.id" = %turn_id,
    );
}

fn request_kind_for_method(method: &str) -> Option<TurnRequestKind> {
    match method {
        TURN_START_METHOD => Some(TurnRequestKind::Start),
        TURN_STEER_METHOD => Some(TurnRequestKind::Steer),
        _ => None,
    }
}

fn read_turn_id_from_notification_params(value: &Value) -> Option<String> {
    value["params"]["turn"]["id"]
        .as_str()
        .map(ToString::to_string)
        .or_else(|| value["params"]["turnId"].as_str().map(ToString::to_string))
}

fn read_item_type_from_notification_params(value: &Value) -> Option<String> {
    value["params"]["item"]["type"]
        .as_str()
        .map(ToString::to_string)
}

fn read_turn_status_from_notification_params(value: &Value) -> Option<String> {
    value["params"]["turn"]["status"]
        .as_str()
        .map(ToString::to_string)
}

fn read_interrupt_target_turn_id_from_request(value: &Value) -> Option<String> {
    value["params"]["turnId"]
        .as_str()
        .map(ToString::to_string)
        .or_else(|| {
            value["params"]["expectedTurnId"]
                .as_str()
                .map(ToString::to_string)
        })
}

fn interruption_source_for_client_kind(client_kind: ProxyClientKind) -> &'static str {
    match client_kind {
        ProxyClientKind::MistleAgentClient => "trigger_interrupt",
        ProxyClientKind::Other => "manual_user_interrupt",
        ProxyClientKind::Unknown => "unknown_interrupt",
    }
}

fn interruption_expected_for_source(source: &str) -> bool {
    matches!(
        source,
        "manual_user_interrupt" | "trigger_interrupt" | "control_plane_interrupt"
    )
}

fn interruption_source_for_transport_reason(reason: &str) -> &'static str {
    match reason {
        "client_close"
        | "client_terminated"
        | "client_stream_ended"
        | "client_socket_error"
        | "client_write_error" => "proxy_disconnect",
        _ => "session_reset",
    }
}

fn read_thread_id_from_notification_params(value: &Value) -> Option<String> {
    value["params"]["threadId"]
        .as_str()
        .map(ToString::to_string)
}

fn read_item_id_from_notification_params(value: &Value) -> Option<String> {
    value["params"]["item"]["id"]
        .as_str()
        .map(ToString::to_string)
}

fn is_context_compaction_notification(value: &Value) -> bool {
    value["params"]["item"]["type"].as_str() == Some("contextCompaction")
}

fn read_response_error_message(value: &Value) -> Option<String> {
    value["error"]["message"]
        .as_str()
        .map(ToString::to_string)
        .or_else(|| value["error"]["code"].as_i64().map(|code| code.to_string()))
}

fn start_turn_lifecycle_span(
    request_kind: TurnRequestKind,
    delivery_context: &DeliveryContext,
    thread_id: &str,
    turn_id: &str,
    expected_turn_id: Option<&str>,
) -> tracing::Span {
    let turn_span = match request_kind {
        TurnRequestKind::Start => info_span!(
            "codex_proxy.turn_start",
            "otel.trace_id" = %delivery_trace_id(delivery_context),
            "mistle.traceparent" = %delivery_context.traceparent,
            "mistle.webhook.event_id" = %delivery_webhook_event_id(delivery_context),
            "mistle.delivery.task_id" = %delivery_context.delivery_task_id,
            "mistle.conversation.id" = %delivery_context.conversation_id,
            "mistle.sandbox.instance_id" = %delivery_context.sandbox_instance_id,
            "mistle.provider.conversation_id" = %thread_id,
            "mistle.provider.execution_id" = %turn_id,
            "mistle.turn.id" = %turn_id,
            "mistle.turn.request_kind" = %request_kind.as_log_value(),
            "mistle.turn.expected_id" = field::display(expected_turn_id.unwrap_or("")),
            outcome = field::Empty,
            reason = field::Empty,
            "thread.id" = %thread_id,
            "turn.id" = %turn_id,
        ),
        TurnRequestKind::Steer => info_span!(
            "codex_proxy.turn_steer",
            "otel.trace_id" = %delivery_trace_id(delivery_context),
            "mistle.traceparent" = %delivery_context.traceparent,
            "mistle.webhook.event_id" = %delivery_webhook_event_id(delivery_context),
            "mistle.delivery.task_id" = %delivery_context.delivery_task_id,
            "mistle.conversation.id" = %delivery_context.conversation_id,
            "mistle.sandbox.instance_id" = %delivery_context.sandbox_instance_id,
            "mistle.provider.conversation_id" = %thread_id,
            "mistle.provider.execution_id" = %turn_id,
            "mistle.turn.id" = %turn_id,
            "mistle.turn.request_kind" = %request_kind.as_log_value(),
            "mistle.turn.expected_id" = field::display(expected_turn_id.unwrap_or("")),
            outcome = field::Empty,
            reason = field::Empty,
            "thread.id" = %thread_id,
            "turn.id" = %turn_id,
        ),
    };
    let _ = turn_span.set_parent(extract_delivery_parent_context(delivery_context));
    turn_span
}

fn span_id_for(span: &tracing::Span) -> String {
    span.context().span().span_context().span_id().to_string()
}

fn start_turn_interrupt_span(
    delivery_context: &DeliveryContext,
    thread_id: &str,
    turn_id: &str,
    interruption_source: &str,
    interruption_expected: bool,
) -> tracing::Span {
    let interrupt_span = info_span!(
        "codex_proxy.turn_interrupt",
        "otel.trace_id" = %delivery_trace_id(delivery_context),
        "mistle.traceparent" = %delivery_context.traceparent,
        "mistle.webhook.event_id" = %delivery_webhook_event_id(delivery_context),
        "mistle.delivery.task_id" = %delivery_context.delivery_task_id,
        "mistle.provider.conversation_id" = %thread_id,
        "mistle.turn.id" = %turn_id,
        "mistle.turn.interruption_source" = %interruption_source,
        "mistle.turn.interruption_expected" = interruption_expected,
        "thread.id" = %thread_id,
        "turn.id" = %turn_id,
    );
    let _ = interrupt_span.set_parent(extract_delivery_parent_context(delivery_context));
    interrupt_span
}

fn start_thread_compaction_span(
    delivery_context: Option<&DeliveryContext>,
    thread_id: &str,
    turn_id: &str,
    trigger: &str,
    state: &str,
) -> tracing::Span {
    let compaction_span = info_span!(
        "codex_proxy.thread_compact_start",
        "otel.trace_id" =
            field::display(delivery_context.map_or("unknown", delivery_trace_id)),
        "mistle.traceparent" =
            field::display(delivery_context.map_or("", |context| context.traceparent.as_str())),
        "mistle.webhook.event_id" =
            field::display(optional_delivery_webhook_event_id(delivery_context)),
        "mistle.scheduled_action.id" =
            field::display(optional_delivery_scheduled_action_id(delivery_context)),
        "mistle.delivery.task_id" =
            field::display(delivery_context.map_or("", |context| context.delivery_task_id.as_str())),
        "mistle.provider.conversation_id" = %thread_id,
        "mistle.turn.id" = %turn_id,
        "mistle.thread.compaction_state" = %state,
        "mistle.thread.compaction_trigger" = %trigger,
        "thread.id" = %thread_id,
        "turn.id" = %turn_id,
    );
    if let Some(delivery_context) = delivery_context {
        let _ = compaction_span.set_parent(extract_delivery_parent_context(delivery_context));
    }
    compaction_span
}

fn log_turn_lifecycle_event(
    active_turn: &ActiveTurnState,
    event: &'static str,
    outcome: &'static str,
    reason: Option<&str>,
    duration_ms: Option<u128>,
) {
    let _entered = active_turn.span.enter();
    active_turn.span.record("outcome", field::display(outcome));
    if let Some(reason) = reason {
        active_turn.span.record("reason", field::display(reason));
    }

    info!(
        event = event,
        "otel.trace_id" = %delivery_trace_id(&active_turn.delivery_context),
        traceId = %delivery_trace_id(&active_turn.delivery_context),
        spanId = %span_id_for(&active_turn.span),
        webhookEventId = %delivery_webhook_event_id(&active_turn.delivery_context),
        deliveryTaskId = %active_turn.delivery_context.delivery_task_id,
        externalDeliveryId =
            field::display(active_turn.delivery_context.external_delivery_id.as_deref().unwrap_or("")),
        triggerRunId = %active_turn.delivery_context.trigger_run_id,
        conversationId = %active_turn.delivery_context.conversation_id,
        sandboxInstanceId = %active_turn.delivery_context.sandbox_instance_id,
        routeId = field::display(active_turn.delivery_context.route_id.as_deref().unwrap_or("")),
        providerConversationId = %active_turn.thread_id,
        providerExecutionId = %active_turn.turn_id,
        turnId = %active_turn.turn_id,
        threadId = %active_turn.thread_id,
        outcome = outcome,
        reason = field::display(reason.unwrap_or("")),
        durationMs = field::display(duration_ms.map_or(String::new(), |value| value.to_string())),
        "mistle.turn.request_kind" = %active_turn.request_kind.as_log_value(),
        "mistle.turn.id" = %active_turn.turn_id,
        "mistle.turn.expected_id" =
            field::display(active_turn.expected_turn_id.as_deref().unwrap_or("")),
        "mistle.turn.interruption_source" =
            field::display(active_turn.interruption_source.as_deref().unwrap_or("")),
        "mistle.turn.interruption_expected" =
            field::display(active_turn.interruption_expected.map_or(String::new(), |value| value.to_string())),
        interruptionSource =
            field::display(active_turn.interruption_source.as_deref().unwrap_or("")),
        interruptionExpected =
            field::display(active_turn.interruption_expected.map_or(String::new(), |value| value.to_string())),
        "mistle.provider.conversation_id" = %active_turn.thread_id,
        "mistle.provider.execution_id" = %active_turn.turn_id,
        "thread.id" = %active_turn.thread_id,
        "turn.id" = %active_turn.turn_id,
    );
}

fn log_turn_request_failure(
    request_kind: TurnRequestKind,
    delivery_context: &DeliveryContext,
    thread_id: Option<&str>,
    expected_turn_id: Option<&str>,
    reason: Option<&str>,
    duration_ms: u128,
) {
    let delivery_span = start_delivery_proxy_span(
        match request_kind {
            TurnRequestKind::Start => TURN_START_METHOD,
            TurnRequestKind::Steer => TURN_STEER_METHOD,
        },
        delivery_context,
        thread_id,
    );
    let _entered = delivery_span.enter();
    info!(
        event = "codex_proxy.turn.request_failed",
        "otel.trace_id" = %delivery_trace_id(delivery_context),
        traceId = %delivery_trace_id(delivery_context),
        spanId = %span_id_for(&delivery_span),
        webhookEventId = %delivery_webhook_event_id(delivery_context),
        deliveryTaskId = %delivery_context.delivery_task_id,
        externalDeliveryId =
            field::display(delivery_context.external_delivery_id.as_deref().unwrap_or("")),
        triggerRunId = %delivery_context.trigger_run_id,
        conversationId = %delivery_context.conversation_id,
        sandboxInstanceId = %delivery_context.sandbox_instance_id,
        routeId = field::display(delivery_context.route_id.as_deref().unwrap_or("")),
        providerConversationId = field::display(thread_id.unwrap_or("")),
        providerExecutionId = field::display(expected_turn_id.unwrap_or("")),
        turnId = field::display(expected_turn_id.unwrap_or("")),
        threadId = field::display(thread_id.unwrap_or("")),
        outcome = "failed",
        reason = field::display(reason.unwrap_or("rpc_error")),
        durationMs = duration_ms,
        "mistle.turn.request_kind" = %request_kind.as_log_value(),
        "mistle.turn.expected_id" = field::display(expected_turn_id.unwrap_or("")),
        "thread.id" = field::display(thread_id.unwrap_or("")),
        "turn.id" = field::display(expected_turn_id.unwrap_or("")),
    );
}

fn log_turn_interrupt_requested(
    delivery_context: &DeliveryContext,
    thread_id: &str,
    turn_id: &str,
    interruption_source: &str,
    interruption_expected: bool,
    interruption_initiator: &str,
) {
    let interrupt_span = start_turn_interrupt_span(
        delivery_context,
        thread_id,
        turn_id,
        interruption_source,
        interruption_expected,
    );
    let _entered = interrupt_span.enter();
    info!(
        event = "codex_proxy.turn.interrupt_requested",
        "otel.trace_id" = %delivery_trace_id(delivery_context),
        traceId = %delivery_trace_id(delivery_context),
        spanId = %span_id_for(&interrupt_span),
        webhookEventId = %delivery_webhook_event_id(delivery_context),
        deliveryTaskId = %delivery_context.delivery_task_id,
        externalDeliveryId =
            field::display(delivery_context.external_delivery_id.as_deref().unwrap_or("")),
        triggerRunId = %delivery_context.trigger_run_id,
        conversationId = %delivery_context.conversation_id,
        sandboxInstanceId = %delivery_context.sandbox_instance_id,
        routeId = field::display(delivery_context.route_id.as_deref().unwrap_or("")),
        providerConversationId = %thread_id,
        providerExecutionId = %turn_id,
        turnId = %turn_id,
        threadId = %thread_id,
        interruptionSource = %interruption_source,
        interruptionExpected = interruption_expected,
        interruptionInitiator = %interruption_initiator,
        outcome = "accepted",
        "mistle.turn.interruption_source" = %interruption_source,
        "mistle.turn.interruption_expected" = interruption_expected,
        "thread.id" = %thread_id,
        "turn.id" = %turn_id,
    );
}

fn log_turn_interrupt_request_failed(
    delivery_context: &DeliveryContext,
    thread_id: &str,
    turn_id: &str,
    interruption_source: &str,
    interruption_expected: bool,
    reason: Option<&str>,
    duration_ms: u128,
) {
    let interrupt_span = start_turn_interrupt_span(
        delivery_context,
        thread_id,
        turn_id,
        interruption_source,
        interruption_expected,
    );
    let _entered = interrupt_span.enter();
    info!(
        event = "codex_proxy.turn.interrupt_request_failed",
        "otel.trace_id" = %delivery_trace_id(delivery_context),
        traceId = %delivery_trace_id(delivery_context),
        spanId = %span_id_for(&interrupt_span),
        webhookEventId = %delivery_webhook_event_id(delivery_context),
        deliveryTaskId = %delivery_context.delivery_task_id,
        externalDeliveryId =
            field::display(delivery_context.external_delivery_id.as_deref().unwrap_or("")),
        triggerRunId = %delivery_context.trigger_run_id,
        conversationId = %delivery_context.conversation_id,
        sandboxInstanceId = %delivery_context.sandbox_instance_id,
        routeId = field::display(delivery_context.route_id.as_deref().unwrap_or("")),
        providerConversationId = %thread_id,
        providerExecutionId = %turn_id,
        turnId = %turn_id,
        threadId = %thread_id,
        interruptionSource = %interruption_source,
        interruptionExpected = interruption_expected,
        outcome = "failed",
        reason = field::display(reason.unwrap_or("rpc_error")),
        durationMs = duration_ms,
        "mistle.turn.interruption_source" = %interruption_source,
        "mistle.turn.interruption_expected" = interruption_expected,
        "thread.id" = %thread_id,
        "turn.id" = %turn_id,
    );
}

fn log_thread_compaction_event(
    active_compaction: &ActiveCompactionState,
    event: &'static str,
    outcome: &'static str,
    state: &'static str,
    reason: Option<&str>,
    duration_ms: Option<u128>,
) {
    let _entered = active_compaction.span.enter();
    info!(
        event = event,
        "otel.trace_id" =
            field::display(active_compaction.delivery_context.as_ref().map_or("unknown", delivery_trace_id)),
        traceId =
            field::display(active_compaction.delivery_context.as_ref().map_or("unknown", delivery_trace_id)),
        spanId = %span_id_for(&active_compaction.span),
        webhookEventId = field::display(
            optional_delivery_webhook_event_id(active_compaction.delivery_context.as_ref())
        ),
        scheduledActionId = field::display(
            optional_delivery_scheduled_action_id(active_compaction.delivery_context.as_ref())
        ),
        deliveryTaskId = field::display(
            active_compaction
                .delivery_context
                .as_ref()
                .map_or("", |context| context.delivery_task_id.as_str())
        ),
        externalDeliveryId = field::display(
            active_compaction.delivery_context.as_ref().and_then(|context| context.external_delivery_id.as_deref()).unwrap_or("")
        ),
        triggerRunId = field::display(
            active_compaction
                .delivery_context
                .as_ref()
                .map_or("", |context| context.trigger_run_id.as_str())
        ),
        conversationId = field::display(
            active_compaction
                .delivery_context
                .as_ref()
                .map_or("", |context| context.conversation_id.as_str())
        ),
        sandboxInstanceId = field::display(
            active_compaction
                .delivery_context
                .as_ref()
                .map_or("", |context| context.sandbox_instance_id.as_str())
        ),
        routeId = field::display(
            active_compaction
                .delivery_context
                .as_ref()
                .and_then(|context| context.route_id.as_deref())
                .unwrap_or("")
        ),
        providerConversationId = %active_compaction.thread_id,
        providerExecutionId = %active_compaction.turn_id,
        turnId = %active_compaction.turn_id,
        threadId = %active_compaction.thread_id,
        outcome = outcome,
        reason = field::display(reason.unwrap_or("")),
        durationMs = field::display(duration_ms.map_or(String::new(), |value| value.to_string())),
        compactionState = %state,
        compactionTrigger = %active_compaction.trigger,
        "mistle.thread.compaction_state" = %state,
        "mistle.thread.compaction_trigger" = %active_compaction.trigger,
        "thread.id" = %active_compaction.thread_id,
        "turn.id" = %active_compaction.turn_id,
    );
}

fn log_thread_compaction_requested(
    delivery_context: Option<&DeliveryContext>,
    thread_id: &str,
    trigger: &str,
    duration_ms: u128,
) {
    let compaction_span =
        start_thread_compaction_span(delivery_context, thread_id, "", trigger, "requested");
    let _entered = compaction_span.enter();
    info!(
        event = "codex.thread.compaction_requested",
        "otel.trace_id" = field::display(delivery_context.map_or("unknown", delivery_trace_id)),
        traceId = field::display(delivery_context.map_or("unknown", delivery_trace_id)),
        spanId = %span_id_for(&compaction_span),
        webhookEventId =
            field::display(optional_delivery_webhook_event_id(delivery_context)),
        scheduledActionId =
            field::display(optional_delivery_scheduled_action_id(delivery_context)),
        deliveryTaskId =
            field::display(delivery_context.map_or("", |context| context.delivery_task_id.as_str())),
        externalDeliveryId = field::display(
            delivery_context.and_then(|context| context.external_delivery_id.as_deref()).unwrap_or("")
        ),
        triggerRunId =
            field::display(delivery_context.map_or("", |context| context.trigger_run_id.as_str())),
        conversationId =
            field::display(delivery_context.map_or("", |context| context.conversation_id.as_str())),
        sandboxInstanceId =
            field::display(delivery_context.map_or("", |context| context.sandbox_instance_id.as_str())),
        routeId = field::display(
            delivery_context.and_then(|context| context.route_id.as_deref()).unwrap_or("")
        ),
        providerConversationId = %thread_id,
        providerExecutionId = "",
        turnId = "",
        threadId = %thread_id,
        outcome = "accepted",
        reason = "",
        durationMs = duration_ms,
        compactionState = "requested",
        compactionTrigger = %trigger,
        "mistle.thread.compaction_state" = "requested",
        "mistle.thread.compaction_trigger" = %trigger,
        "thread.id" = %thread_id,
    );
}

fn log_thread_compaction_request_failed(
    delivery_context: Option<&DeliveryContext>,
    thread_id: &str,
    trigger: &str,
    reason: Option<&str>,
    duration_ms: u128,
) {
    let compaction_span =
        start_thread_compaction_span(delivery_context, thread_id, "", trigger, "requested");
    let _entered = compaction_span.enter();
    info!(
        event = "codex.thread.compaction_request_failed",
        "otel.trace_id" = field::display(delivery_context.map_or("unknown", delivery_trace_id)),
        traceId = field::display(delivery_context.map_or("unknown", delivery_trace_id)),
        spanId = %span_id_for(&compaction_span),
        webhookEventId =
            field::display(optional_delivery_webhook_event_id(delivery_context)),
        scheduledActionId =
            field::display(optional_delivery_scheduled_action_id(delivery_context)),
        deliveryTaskId =
            field::display(delivery_context.map_or("", |context| context.delivery_task_id.as_str())),
        externalDeliveryId = field::display(
            delivery_context.and_then(|context| context.external_delivery_id.as_deref()).unwrap_or("")
        ),
        triggerRunId =
            field::display(delivery_context.map_or("", |context| context.trigger_run_id.as_str())),
        conversationId =
            field::display(delivery_context.map_or("", |context| context.conversation_id.as_str())),
        sandboxInstanceId =
            field::display(delivery_context.map_or("", |context| context.sandbox_instance_id.as_str())),
        routeId = field::display(
            delivery_context.and_then(|context| context.route_id.as_deref()).unwrap_or("")
        ),
        providerConversationId = %thread_id,
        providerExecutionId = "",
        turnId = "",
        threadId = %thread_id,
        outcome = "failed",
        reason = field::display(reason.unwrap_or("rpc_error")),
        durationMs = duration_ms,
        compactionState = "requested",
        compactionTrigger = %trigger,
        "mistle.thread.compaction_state" = "requested",
        "mistle.thread.compaction_trigger" = %trigger,
        "thread.id" = %thread_id,
    );
}

fn log_pending_thread_compaction_unknown_terminal_outcome(
    delivery_context: Option<&DeliveryContext>,
    thread_id: &str,
    trigger: &str,
    reason: &'static str,
    requested_at: Instant,
) {
    let compaction_span = start_thread_compaction_span(
        delivery_context,
        thread_id,
        "",
        trigger,
        "unknown_terminal_outcome",
    );
    let _entered = compaction_span.enter();
    info!(
        event = "codex.thread.compaction_unknown_terminal_outcome",
        "otel.trace_id" = field::display(delivery_context.map_or("unknown", delivery_trace_id)),
        traceId = field::display(delivery_context.map_or("unknown", delivery_trace_id)),
        spanId = %span_id_for(&compaction_span),
        webhookEventId =
            field::display(optional_delivery_webhook_event_id(delivery_context)),
        scheduledActionId =
            field::display(optional_delivery_scheduled_action_id(delivery_context)),
        deliveryTaskId =
            field::display(delivery_context.map_or("", |context| context.delivery_task_id.as_str())),
        externalDeliveryId = field::display(
            delivery_context.and_then(|context| context.external_delivery_id.as_deref()).unwrap_or("")
        ),
        triggerRunId =
            field::display(delivery_context.map_or("", |context| context.trigger_run_id.as_str())),
        conversationId =
            field::display(delivery_context.map_or("", |context| context.conversation_id.as_str())),
        sandboxInstanceId =
            field::display(delivery_context.map_or("", |context| context.sandbox_instance_id.as_str())),
        routeId = field::display(
            delivery_context.and_then(|context| context.route_id.as_deref()).unwrap_or("")
        ),
        providerConversationId = %thread_id,
        providerExecutionId = "",
        turnId = "",
        threadId = %thread_id,
        outcome = "failed",
        reason = %reason,
        durationMs = requested_at.elapsed().as_millis(),
        compactionState = "unknown_terminal_outcome",
        compactionTrigger = %trigger,
        "mistle.thread.compaction_state" = "unknown_terminal_outcome",
        "mistle.thread.compaction_trigger" = %trigger,
        "thread.id" = %thread_id,
    );
}

fn finalize_active_compactions_for_transport_outcome(
    active_compactions: &mut BTreeMap<String, ActiveCompactionState>,
    transport_reason: &'static str,
) {
    let unresolved_item_ids: Vec<String> = active_compactions.keys().cloned().collect();
    for item_id in unresolved_item_ids {
        if let Some(active_compaction) = active_compactions.remove(item_id.as_str()) {
            log_thread_compaction_event(
                &active_compaction,
                "codex.thread.compaction_unknown_terminal_outcome",
                "failed",
                "unknown_terminal_outcome",
                Some(transport_reason),
                Some(
                    active_compaction
                        .requested_at
                        .unwrap_or(active_compaction.started_at)
                        .elapsed()
                        .as_millis(),
                ),
            );
        }
    }
}

fn finalize_pending_compactions_for_transport_outcome(
    pending_compaction_requests: &mut BTreeMap<String, PendingCompactionRequest>,
    transport_reason: &'static str,
) {
    let unresolved_thread_ids: Vec<String> = pending_compaction_requests.keys().cloned().collect();
    for thread_id in unresolved_thread_ids {
        if let Some(pending_compaction_request) =
            pending_compaction_requests.remove(thread_id.as_str())
        {
            log_pending_thread_compaction_unknown_terminal_outcome(
                pending_compaction_request.delivery_context.as_ref(),
                thread_id.as_str(),
                pending_compaction_request.trigger.as_str(),
                transport_reason,
                pending_compaction_request.requested_at,
            );
        }
    }
}

fn finalize_unresolved_compactions_for_transport_outcome(
    pending_compaction_requests: &mut BTreeMap<String, PendingCompactionRequest>,
    active_compactions: &mut BTreeMap<String, ActiveCompactionState>,
    transport_reason: &'static str,
) {
    finalize_pending_compactions_for_transport_outcome(
        pending_compaction_requests,
        transport_reason,
    );
    finalize_active_compactions_for_transport_outcome(active_compactions, transport_reason);
}

fn finalize_active_turns_for_transport_outcome(
    active_turns: &mut BTreeMap<String, ActiveTurnState>,
    transport_outcome: &'static str,
    transport_reason: &'static str,
) {
    let unresolved_turn_ids: Vec<String> = active_turns.keys().cloned().collect();
    for turn_id in unresolved_turn_ids {
        if let Some(mut active_turn) = active_turns.remove(turn_id.as_str()) {
            if active_turn.interruption_source.is_none() {
                active_turn.interruption_source =
                    Some(interruption_source_for_transport_reason(transport_reason).to_string());
                active_turn.interruption_expected = Some(false);
            }
            let reason = if active_turn.started_at.is_some() && active_turn.first_item_at.is_none()
            {
                Some("started_but_no_output")
            } else {
                Some(transport_reason)
            };
            log_turn_lifecycle_event(
                &active_turn,
                "codex_proxy.turn.interrupted",
                "interrupted",
                Some(transport_reason),
                Some(active_turn.request_started_at.elapsed().as_millis()),
            );
            log_turn_lifecycle_event(
                &active_turn,
                "codex_proxy.turn.transport_ended",
                transport_outcome,
                reason,
                Some(active_turn.request_started_at.elapsed().as_millis()),
            );
            log_turn_lifecycle_event(
                &active_turn,
                "codex_proxy.turn.stalled",
                "stalled",
                Some(transport_reason),
                Some(active_turn.request_started_at.elapsed().as_millis()),
            );
        }
    }
}

fn observe_server_notification(
    message: &Message,
    active_turns: &mut BTreeMap<String, ActiveTurnState>,
    thread_delivery_contexts: &BTreeMap<String, DeliveryContext>,
    pending_compaction_requests: &mut BTreeMap<String, PendingCompactionRequest>,
    active_compactions: &mut BTreeMap<String, ActiveCompactionState>,
) -> Result<(), CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Ok(());
    };
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Ok(());
    };

    match method {
        "turn/started" => {
            let Some(turn_id) = read_turn_id_from_notification_params(&value) else {
                return Ok(());
            };
            let Some(active_turn) = active_turns.get_mut(turn_id.as_str()) else {
                return Ok(());
            };
            active_turn.started_at = Some(Instant::now());
            log_turn_lifecycle_event(
                active_turn,
                "codex_proxy.turn.started",
                "started",
                None,
                Some(active_turn.request_started_at.elapsed().as_millis()),
            );
        }
        "item/started" => {
            if is_context_compaction_notification(&value)
                && let (Some(thread_id), Some(turn_id), Some(item_id)) = (
                    read_thread_id_from_notification_params(&value),
                    read_turn_id_from_notification_params(&value),
                    read_item_id_from_notification_params(&value),
                )
            {
                let pending_request = pending_compaction_requests.remove(thread_id.as_str());
                let delivery_context = pending_request
                    .as_ref()
                    .and_then(|request| request.delivery_context.clone())
                    .or_else(|| thread_delivery_contexts.get(thread_id.as_str()).cloned());
                let trigger = if pending_request.is_some() {
                    "unknown"
                } else {
                    "automatic"
                }
                .to_string();
                let started_at = Instant::now();
                let active_compaction = ActiveCompactionState {
                    span: start_thread_compaction_span(
                        delivery_context.as_ref(),
                        thread_id.as_str(),
                        turn_id.as_str(),
                        trigger.as_str(),
                        "started",
                    ),
                    delivery_context,
                    thread_id,
                    turn_id,
                    requested_at: pending_request.map(|request| request.requested_at),
                    started_at,
                    trigger,
                };
                log_thread_compaction_event(
                    &active_compaction,
                    "codex.thread.compaction_started",
                    "started",
                    "started",
                    None,
                    Some(
                        active_compaction
                            .requested_at
                            .unwrap_or(active_compaction.started_at)
                            .elapsed()
                            .as_millis(),
                    ),
                );
                active_compactions.insert(item_id, active_compaction);
                return Ok(());
            }
            let Some(turn_id) = read_turn_id_from_notification_params(&value) else {
                return Ok(());
            };
            let Some(active_turn) = active_turns.get_mut(turn_id.as_str()) else {
                return Ok(());
            };
            if active_turn.first_item_at.is_none() {
                active_turn.first_item_at = Some(Instant::now());
                active_turn.first_item_type = read_item_type_from_notification_params(&value);
                log_turn_lifecycle_event(
                    active_turn,
                    "codex_proxy.turn.first_item",
                    "started",
                    active_turn.first_item_type.as_deref(),
                    Some(active_turn.request_started_at.elapsed().as_millis()),
                );
            }
        }
        "item/completed" => {
            if is_context_compaction_notification(&value)
                && let Some(item_id) = read_item_id_from_notification_params(&value)
                && let Some(active_compaction) = active_compactions.remove(item_id.as_str())
            {
                log_thread_compaction_event(
                    &active_compaction,
                    "codex.thread.compaction_completed",
                    "compacted",
                    "completed",
                    None,
                    Some(
                        active_compaction
                            .requested_at
                            .unwrap_or(active_compaction.started_at)
                            .elapsed()
                            .as_millis(),
                    ),
                );
            }
        }
        "turn/completed" => {
            let Some(turn_id) = read_turn_id_from_notification_params(&value) else {
                return Ok(());
            };
            let Some(mut active_turn) = active_turns.remove(turn_id.as_str()) else {
                return Ok(());
            };
            let status = read_turn_status_from_notification_params(&value)
                .unwrap_or_else(|| "unknown".to_string());
            let (outcome, reason) = match status.as_str() {
                "completed" => ("completed", None),
                "failed" => (
                    "failed",
                    Some(if active_turn.first_item_at.is_none() {
                        "failed_before_first_item"
                    } else {
                        "failed_after_output"
                    }),
                ),
                "interrupted" => {
                    if active_turn.interruption_source.is_none() {
                        active_turn.interruption_source = Some("unknown_interrupt".to_string());
                        active_turn.interruption_expected = Some(false);
                    }
                    ("interrupted", None)
                }
                _ => ("failed", Some("unknown_turn_status")),
            };
            log_turn_lifecycle_event(
                &active_turn,
                "codex_proxy.turn.completed",
                outcome,
                reason,
                Some(active_turn.request_started_at.elapsed().as_millis()),
            );
            if outcome == "interrupted" {
                log_turn_lifecycle_event(
                    &active_turn,
                    "codex_proxy.turn.interrupted",
                    "interrupted",
                    reason,
                    Some(active_turn.request_started_at.elapsed().as_millis()),
                );
            }
        }
        _ => {}
    }

    Ok(())
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

mod delivery_context;

#[cfg(test)]
mod tests {
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

    use super::{
        ActiveCompactionState, ActiveTurnState, ClientForwardContext, PendingCompactionRequest,
        TurnRequestKind, finalize_active_compactions_for_transport_outcome,
        finalize_active_turns_for_transport_outcome,
        finalize_unresolved_compactions_for_transport_outcome, log_delivery_context_mapping,
        matched_retention_target, observe_server_notification, should_forward_client_message,
        start_delivery_proxy_span, start_thread_compaction_span, start_turn_lifecycle_span,
        take_ready_buffered_success_responses,
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

            finalize_active_turns_for_transport_outcome(
                &mut active_turns,
                "reset",
                "raw_socket_error",
            );

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

            finalize_active_turns_for_transport_outcome(
                &mut active_turns,
                "reset",
                "raw_socket_error",
            );

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
            let thread_delivery_contexts = std::collections::BTreeMap::from([(
                "thr_123".to_string(),
                test_delivery_context(),
            )]);
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
            let thread_delivery_contexts = std::collections::BTreeMap::from([(
                "thr_123".to_string(),
                test_delivery_context(),
            )]);
            let turn_delivery_contexts = std::collections::BTreeMap::from([(
                "turn_123".to_string(),
                test_delivery_context(),
            )]);
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
            let thread_delivery_contexts = std::collections::BTreeMap::from([(
                "thr_123".to_string(),
                test_delivery_context(),
            )]);
            let turn_delivery_contexts = std::collections::BTreeMap::from([(
                "turn_123".to_string(),
                test_delivery_context(),
            )]);
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

        let ready_responses =
            take_ready_buffered_success_responses(&mut buffered_success_responses);
        assert_eq!(ready_responses.len(), 2);
        assert_eq!(ready_responses[0].request_id, json!(1));
        assert_eq!(ready_responses[1].request_id, json!(2));
        assert!(buffered_success_responses.is_empty());
    }
}
