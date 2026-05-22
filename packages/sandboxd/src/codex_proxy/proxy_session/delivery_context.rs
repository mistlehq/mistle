//! Parsing helpers for Mistle delivery metadata sent through the Codex proxy.
//!
//! Delivery context is carried as JSON-RPC payload data from trusted Mistle
//! clients and then attached to turn telemetry spans and retained-thread logs.

use std::io::ErrorKind;
use std::sync::OnceLock;

use opentelemetry::Context as OtelContext;
use opentelemetry::propagation::{Extractor, TextMapCompositePropagator, TextMapPropagator};
use opentelemetry_sdk::propagation::{BaggagePropagator, TraceContextPropagator};
use serde_json::Value;

use crate::codex_proxy::CodexProxyError;
use crate::codex_proxy::types::{DeliveryContext, DeliveryContextPayload};

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

pub(super) fn delivery_trace_id(delivery_context: &DeliveryContext) -> &str {
    read_trace_id(delivery_context.traceparent.as_str()).unwrap_or("unknown")
}

pub(super) fn delivery_source(delivery_context: &DeliveryContext) -> &str {
    delivery_context.source.as_str()
}

pub(super) fn delivery_webhook_event_id(delivery_context: &DeliveryContext) -> &str {
    delivery_context.webhook_event_id.as_deref().unwrap_or("")
}

pub(super) fn delivery_scheduled_action_id(delivery_context: &DeliveryContext) -> &str {
    delivery_context
        .scheduled_action_id
        .as_deref()
        .unwrap_or("")
}

pub(super) fn optional_delivery_webhook_event_id(
    delivery_context: Option<&DeliveryContext>,
) -> &str {
    delivery_context
        .and_then(|context| context.webhook_event_id.as_deref())
        .unwrap_or("")
}

pub(super) fn optional_delivery_scheduled_action_id(
    delivery_context: Option<&DeliveryContext>,
) -> &str {
    delivery_context
        .and_then(|context| context.scheduled_action_id.as_deref())
        .unwrap_or("")
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

pub(super) fn extract_delivery_parent_context(delivery_context: &DeliveryContext) -> OtelContext {
    DELIVERY_CONTEXT_PROPAGATOR
        .get_or_init(|| {
            TextMapCompositePropagator::new(vec![
                Box::new(TraceContextPropagator::new()),
                Box::new(BaggagePropagator::new()),
            ])
        })
        .extract(&DeliveryContextExtractor { delivery_context })
}

pub(super) fn parse_delivery_context_payload(
    value: &Value,
) -> Result<DeliveryContext, CodexProxyError> {
    let payload = serde_json::from_value::<DeliveryContextPayload>(
        value.get("params").cloned().unwrap_or(Value::Null),
    )
    .map_err(CodexProxyError::InvalidJson)?;
    DeliveryContext::try_from(payload).map_err(|message| {
        CodexProxyError::InvalidJson(serde_json::Error::io(std::io::Error::new(
            ErrorKind::InvalidData,
            message,
        )))
    })
}
