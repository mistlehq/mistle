use std::collections::BTreeMap;
use std::time::Instant;

use opentelemetry::trace::TraceContextExt as _;
use serde_json::Value;
use tracing::{field, info, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tungstenite::Message;

use crate::codex_proxy::CodexProxyError;
use crate::codex_proxy::proxy_session::delivery_context::{
    delivery_scheduled_action_id, delivery_source, delivery_trace_id, delivery_webhook_event_id,
    extract_delivery_parent_context, optional_delivery_scheduled_action_id,
    optional_delivery_webhook_event_id,
};
use crate::codex_proxy::proxy_session::json_rpc::parse_json_value_from_message;
use crate::codex_proxy::proxy_session::{
    SET_DELIVERY_CONTEXT_METHOD, TURN_START_METHOD, TURN_STEER_METHOD,
};
use crate::codex_proxy::types::{DeliveryContext, PendingClientRequest, ProxyClientKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TurnRequestKind {
    Start,
    Steer,
}

impl TurnRequestKind {
    pub(super) fn as_log_value(self) -> &'static str {
        match self {
            Self::Start => "turn_start",
            Self::Steer => "turn_steer",
        }
    }
}

pub(super) struct ActiveTurnState {
    pub(super) delivery_context: DeliveryContext,
    pub(super) thread_id: String,
    pub(super) turn_id: String,
    pub(super) expected_turn_id: Option<String>,
    pub(super) request_kind: TurnRequestKind,
    pub(super) request_started_at: Instant,
    pub(super) started_at: Option<Instant>,
    pub(super) first_item_at: Option<Instant>,
    pub(super) first_item_type: Option<String>,
    pub(super) interruption_source: Option<String>,
    pub(super) interruption_expected: Option<bool>,
    pub(super) span: tracing::Span,
}

pub(super) struct PendingCompactionRequest {
    pub(super) delivery_context: Option<DeliveryContext>,
    pub(super) requested_at: Instant,
    pub(super) trigger: String,
}

pub(super) struct ActiveCompactionState {
    pub(super) delivery_context: Option<DeliveryContext>,
    pub(super) thread_id: String,
    pub(super) turn_id: String,
    pub(super) requested_at: Option<Instant>,
    pub(super) started_at: Instant,
    pub(super) trigger: String,
    pub(super) span: tracing::Span,
}

pub(super) struct ClientForwardContext<'a> {
    pub(super) thread_delivery_contexts: &'a BTreeMap<String, DeliveryContext>,
    pub(super) turn_delivery_contexts: &'a BTreeMap<String, DeliveryContext>,
    pub(super) active_turns: &'a mut BTreeMap<String, ActiveTurnState>,
    pub(super) pending_compaction_requests: &'a mut BTreeMap<String, PendingCompactionRequest>,
    pub(super) pending_requests: &'a mut BTreeMap<String, PendingClientRequest>,
}

pub(super) fn start_delivery_proxy_span(
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

pub(super) fn log_delivery_context_received(delivery_context: &DeliveryContext) {
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

pub(super) fn log_delivery_context_mapping(
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

pub(super) fn request_kind_for_method(method: &str) -> Option<TurnRequestKind> {
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

pub(super) fn read_interrupt_target_turn_id_from_request(value: &Value) -> Option<String> {
    value["params"]["turnId"]
        .as_str()
        .map(ToString::to_string)
        .or_else(|| {
            value["params"]["expectedTurnId"]
                .as_str()
                .map(ToString::to_string)
        })
}

pub(super) fn interruption_source_for_client_kind(client_kind: ProxyClientKind) -> &'static str {
    match client_kind {
        ProxyClientKind::MistleAgentClient => "trigger_interrupt",
        ProxyClientKind::Other => "manual_user_interrupt",
        ProxyClientKind::Unknown => "unknown_interrupt",
    }
}

pub(super) fn interruption_expected_for_source(source: &str) -> bool {
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

pub(super) fn read_response_error_message(value: &Value) -> Option<String> {
    value["error"]["message"]
        .as_str()
        .map(ToString::to_string)
        .or_else(|| value["error"]["code"].as_i64().map(|code| code.to_string()))
}

pub(super) fn start_turn_lifecycle_span(
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

pub(super) fn start_thread_compaction_span(
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

pub(super) fn log_turn_lifecycle_event(
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

pub(super) fn log_turn_request_failure(
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

pub(super) fn log_turn_interrupt_requested(
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

pub(super) fn log_turn_interrupt_request_failed(
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

pub(super) fn log_thread_compaction_requested(
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

pub(super) fn log_thread_compaction_request_failed(
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

pub(super) fn log_pending_thread_compaction_unknown_terminal_outcome(
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

pub(super) fn finalize_active_compactions_for_transport_outcome(
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

pub(super) fn finalize_unresolved_compactions_for_transport_outcome(
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

pub(super) fn finalize_active_turns_for_transport_outcome(
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

pub(super) fn observe_server_notification(
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
