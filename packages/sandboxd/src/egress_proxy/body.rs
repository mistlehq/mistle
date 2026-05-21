use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::Bytes;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full};
use hyper::body::{Body, Frame, SizeHint};
use hyper::{Response, StatusCode};
use serde_json::Value;

use crate::egress_proxy::logging::emit_egress_proxy_log;
use crate::time::Clock;

pub(super) type BoxError = Box<dyn std::error::Error + Send + Sync>;
pub(super) type HyperBody = BoxBody<Bytes, BoxError>;

#[derive(Clone)]
pub(super) struct EgressProxyRequestContext {
    pub(super) sandbox_instance_id: String,
    pub(super) request_id: String,
    pub(super) method: String,
    pub(super) authority: String,
    pub(super) host: String,
    pub(super) path_and_query: String,
    pub(super) route_mode: &'static str,
    pub(super) egress_rule_id: Option<String>,
    pub(super) upstream_url: String,
    pub(super) started_at_ms: u64,
    pub(super) clock: Arc<dyn Clock>,
}

pub(super) struct InstrumentedResponseBody {
    pub(super) inner: HyperBody,
    pub(super) context: Arc<EgressProxyRequestContext>,
    pub(super) upstream_status: StatusCode,
    pub(super) upstream_trace_id: Option<String>,
    pub(super) chunk_count: u64,
    pub(super) forwarded_bytes: u64,
    pub(super) first_chunk_at_ms: Option<u64>,
    pub(super) ended: bool,
}

impl EgressProxyRequestContext {
    fn elapsed_ms(&self) -> u64 {
        self.clock.now_ms().saturating_sub(self.started_at_ms)
    }

    pub(super) fn common_fields(&self) -> Vec<(&'static str, Value)> {
        let mut fields = vec![
            ("requestId", Value::String(self.request_id.clone())),
            ("method", Value::String(self.method.clone())),
            ("authority", Value::String(self.authority.clone())),
            ("host", Value::String(self.host.clone())),
            ("pathAndQuery", Value::String(self.path_and_query.clone())),
            ("routeMode", Value::String(self.route_mode.to_string())),
            ("upstreamUrl", Value::String(self.upstream_url.clone())),
            ("elapsedMs", Value::from(self.elapsed_ms())),
        ];
        if let Some(egress_rule_id) = &self.egress_rule_id {
            fields.push(("egressRuleId", Value::String(egress_rule_id.clone())));
        }
        fields
    }
}

impl InstrumentedResponseBody {
    fn finalize(
        &mut self,
        event: &'static str,
        outcome: &'static str,
        error: Option<&str>,
        extra_fields: &[(&str, Value)],
    ) {
        if self.ended {
            return;
        }
        self.ended = true;
        let mut fields = self.context.common_fields();
        fields.push((
            "upstreamStatus",
            Value::from(u64::from(self.upstream_status.as_u16())),
        ));
        fields.push(("outcome", Value::String(outcome.to_string())));
        fields.push(("chunkCount", Value::from(self.chunk_count)));
        fields.push(("forwardedBytes", Value::from(self.forwarded_bytes)));
        if let Some(first_chunk_at_ms) = self.first_chunk_at_ms {
            fields.push((
                "firstChunkLatencyMs",
                Value::from(first_chunk_at_ms.saturating_sub(self.context.started_at_ms)),
            ));
        }
        if let Some(upstream_trace_id) = &self.upstream_trace_id {
            fields.push(("upstreamTraceId", Value::String(upstream_trace_id.clone())));
        }
        if let Some(error) = error {
            fields.push(("error", Value::String(error.to_string())));
        }
        fields.extend(
            extra_fields
                .iter()
                .map(|(name, value)| (*name, value.clone())),
        );
        emit_egress_proxy_log(
            self.context.clock.as_ref(),
            &self.context.sandbox_instance_id,
            event,
            &fields,
        );
    }
}

impl Body for InstrumentedResponseBody {
    type Data = Bytes;
    type Error = BoxError;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        match Pin::new(&mut self.inner).poll_frame(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(data) = frame.data_ref() {
                    self.chunk_count = self.chunk_count.saturating_add(1);
                    self.forwarded_bytes = self
                        .forwarded_bytes
                        .saturating_add(data.len().try_into().unwrap_or(u64::MAX));
                    if self.first_chunk_at_ms.is_none() {
                        let first_chunk_at_ms = self.context.clock.now_ms();
                        self.first_chunk_at_ms = Some(first_chunk_at_ms);
                        let mut fields = self.context.common_fields();
                        fields.push((
                            "upstreamStatus",
                            Value::from(u64::from(self.upstream_status.as_u16())),
                        ));
                        fields.push((
                            "firstChunkLatencyMs",
                            Value::from(
                                first_chunk_at_ms.saturating_sub(self.context.started_at_ms),
                            ),
                        ));
                        if let Some(upstream_trace_id) = &self.upstream_trace_id {
                            fields.push((
                                "upstreamTraceId",
                                Value::String(upstream_trace_id.clone()),
                            ));
                        }
                        emit_egress_proxy_log(
                            self.context.clock.as_ref(),
                            &self.context.sandbox_instance_id,
                            "egress_proxy_response_body_first_chunk",
                            &fields,
                        );
                    }
                }
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(Some(Err(error))) => {
                let error_message = error.to_string();
                self.finalize(
                    "egress_proxy_response_body_failed",
                    "upstream_error",
                    Some(error_message.as_str()),
                    &[],
                );
                Poll::Ready(Some(Err(error)))
            }
            Poll::Ready(None) => {
                self.finalize(
                    "egress_proxy_response_body_completed",
                    "completed",
                    None,
                    &[],
                );
                Poll::Ready(None)
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

impl Drop for InstrumentedResponseBody {
    fn drop(&mut self) {
        if self.ended {
            return;
        }
        self.finalize(
            "egress_proxy_response_body_cancelled",
            "downstream_cancelled",
            None,
            &[],
        );
    }
}

pub(super) fn infallible_to_box_error(error: Infallible) -> BoxError {
    match error {}
}

pub(super) fn box_body<B>(body: B) -> HyperBody
where
    B: Body<Data = Bytes> + Send + Sync + 'static,
    B::Error: Into<BoxError>,
{
    body.map_err(Into::into).boxed()
}

pub(super) fn empty_body() -> HyperBody {
    box_body(Full::new(Bytes::new()).map_err(infallible_to_box_error))
}

pub(super) fn text_response(status: StatusCode, message: impl Into<String>) -> Response<HyperBody> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(box_body(
            Full::new(Bytes::from(message.into())).map_err(infallible_to_box_error),
        ))
        .expect("text response should build")
}
