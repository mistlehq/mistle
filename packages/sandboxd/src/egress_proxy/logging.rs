use serde_json::{Map, Value};

use crate::supervision::SupervisedComponent;
use crate::time::{Clock, format_rfc3339_timestamp};

#[derive(Clone, Copy)]
pub(super) struct EgressProxyLogContext<'a> {
    pub(super) clock: &'a dyn Clock,
    pub(super) sandbox_instance_id: &'a str,
}

pub(super) fn emit_egress_proxy_log(
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    event: &str,
    extra_fields: &[(&str, Value)],
) {
    if let Some(line) =
        serialize_egress_proxy_log_line(clock, sandbox_instance_id, event, extra_fields)
    {
        eprintln!("{line}");
    }
}

pub(super) fn serialize_egress_proxy_log_line(
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    event: &str,
    extra_fields: &[(&str, Value)],
) -> Option<String> {
    let observed_at = format_rfc3339_timestamp(clock.now_system_time()).ok()?;
    let mut payload = Map::new();
    payload.insert("event".to_string(), Value::String(event.to_string()));
    payload.insert(
        "sandboxInstanceId".to_string(),
        Value::String(sandbox_instance_id.to_string()),
    );
    payload.insert(
        "component".to_string(),
        Value::String(SupervisedComponent::EgressProxy.as_str().to_string()),
    );
    payload.insert("observedAt".to_string(), Value::String(observed_at));
    for (field_name, field_value) in extra_fields {
        payload.insert((*field_name).to_string(), field_value.clone());
    }
    serde_json::to_string(&Value::Object(payload)).ok()
}
