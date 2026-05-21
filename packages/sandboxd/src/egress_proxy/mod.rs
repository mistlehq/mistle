//! Sandbox-local egress proxy for runtime tools and interactive shells.
//!
//! Runtime tools like `gh` and `git` expect standard `HTTP[S]_PROXY` semantics,
//! while Mistle keeps credential-bearing egress decisions in the data-plane
//! gateway. This module exposes one local forward proxy inside the sandbox,
//! terminates proxied HTTPS sessions with a per-sandbox CA, matches each
//! decrypted request against the compiled runtime-plan egress routes, and
//! forwards the request through the data-plane gateway's direct egress routes.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::fmt::{self, Display};
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, TryRecvError};
use std::task::{Context, Poll};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full};
use hyper::body::{Body, Frame, Incoming, SizeHint};
use hyper::client::conn::http1 as client_http1;
use hyper::header::{HOST, HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_rustls::ConfigBuilderExt;
use hyper_util::rt::TokioIo;
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use serde_json::{Map, Value};
use tokio::io::{AsyncRead, AsyncWrite, copy_bidirectional};
use tokio::net::{TcpListener, TcpSocket, TcpStream};
use tokio::runtime::Builder;
use tokio::sync::oneshot;
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::ClientConfig;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ServerConfig, server::Acceptor as RustlsServerAcceptor};
use tokio_rustls::{LazyConfigAcceptor, TlsAcceptor};
use tokio_tungstenite::tungstenite::{
    Message, client::IntoClientRequest, handshake::derive_accept_key, protocol::Role,
};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, client_async, connect_async};
use url::Url;

use crate::egress_proxy::ca::{
    ProxyCaConfig, ProxyCaInstallation, cleanup_proxy_ca_installation, emit_proxy_ca_lifecycle_log,
    load_or_create_persistent_proxy_ca,
};
use crate::egress_proxy::routing::{
    EgressProxyRoute, RequestTarget, RequestTargetOverride, build_gateway_egress_route,
    match_state_route, resolve_request_target,
};
#[cfg(test)]
use crate::egress_proxy::routing::{build_direct_forward_uri, match_route};
#[cfg(all(test, target_os = "linux"))]
use crate::egress_proxy::transparent::socket_addr_from_sockaddr_storage;
use crate::egress_proxy::transparent::{
    TransparentPacketRules, configure_transparent_passthrough_upstream_socket,
    recover_original_destination,
};
#[cfg(test)]
use crate::egress_proxy::transparent::{
    build_nftables_install_commands, build_nftables_rule_plan_with_local_destinations,
    parse_iproute2_link_scope_ipv4_route_cidrs,
};
use crate::protocol::startup::StartupInput;
use crate::proxy_ca::issue_proxy_leaf_certificate;
use crate::runtime::CompiledRuntimePlan;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};
use crate::tunnel::session::GatewayEgressTokenProvider;

const RUNTIME_PROXY_CA_CERT_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca.pem";
const RUNTIME_PROXY_CA_BUNDLE_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem";
const PERSISTENT_PROXY_CA_CERT_PATH: &str = "/var/lib/mistle/sandboxd/egress-proxy-ca.pem";
const PERSISTENT_PROXY_CA_KEY_PATH: &str = "/var/lib/mistle/sandboxd/egress-proxy-ca-key.pem";
const RUNTIME_PROXY_CA_TRUST_STORE_PATH: &str =
    "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt";
const SYSTEM_CA_CERT_BUNDLE_PATH: &str = "/etc/ssl/certs/ca-certificates.crt";
const UPDATE_CA_CERTIFICATES_COMMAND: &str = "update-ca-certificates";
const DEFAULT_LOOPBACK_PROXY_PORT: u16 = 38_513;
const DEFAULT_TRANSPARENT_PROXY_PORT: u16 = 38_514;
#[cfg(target_os = "linux")]
const TRANSPARENT_PASSTHROUGH_SOCKET_MARK: u32 = 38_514;
const TRANSPARENT_NFTABLES_TABLE_NAME: &str = "mistle_transparent_egress";
const STATIC_LOCAL_DESTINATION_IPV4_CIDRS: [&str; 2] = ["127.0.0.0/8", "169.254.0.0/16"];
const EGRESS_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(250);
const EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);
const EGRESS_PROXY_RESTART_BACKOFF_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 5000];
const SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME: &str = "x-mistle-sandbox-egress-id";
const DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME: &str = "x-mistle-egress-token";
const DIRECT_EGRESS_HTTP_ROUTE_PATH: &str = "/_mistle/egress/http";
const DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH: &str = "/_mistle/egress/ws";

const MANAGED_PROXY_ENV_KEYS: [&str; 8] = [
    "SSL_CERT_FILE",
    "CURL_CA_BUNDLE",
    "GIT_SSL_CAINFO",
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "NIX_SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "GIT_SSL_CAPATH",
];

type BoxError = Box<dyn std::error::Error + Send + Sync>;
type HyperBody = BoxBody<Bytes, BoxError>;
#[derive(Clone, Copy)]
struct EgressProxyLogContext<'a> {
    pub(super) clock: &'a dyn Clock,
    pub(super) sandbox_instance_id: &'a str,
}

#[derive(Debug)]
pub struct EgressProxy {
    runtime_env: BTreeMap<String, String>,
    shutdown_requested: Arc<AtomicBool>,
    supervisor_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
    transparent_server: Option<ActiveEgressProxyServer>,
    transparent_packet_rules: Option<TransparentPacketRules>,
    #[cfg(any(test, debug_assertions))]
    supervisor_command_sender: Option<mpsc::Sender<EgressProxySupervisorCommand>>,
    proxy_ca_installation: ProxyCaInstallation,
    supervisor_handle: SandboxdSupervisorHandle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressProxyError {
    message: String,
}

#[derive(Clone)]
enum EgressProxyForwardingMode {
    DirectGateway {
        client: Arc<DirectGatewayEgressClient>,
    },
}

#[derive(Clone)]
struct DirectGatewayEgressClient {
    http_route_url: Url,
    websocket_route_url: Url,
    token_provider: GatewayEgressTokenProvider,
}

#[derive(Clone)]
struct EgressProxyState {
    sandbox_instance_id: String,
    forwarding_mode: EgressProxyForwardingMode,
    routes: Arc<RwLock<Vec<EgressProxyRoute>>>,
    proxy_ca_certificate_pem: Arc<String>,
    proxy_ca_private_key_pem: Arc<String>,
    clock: Arc<dyn Clock>,
    next_request_id: Arc<AtomicU64>,
}

struct EgressProxySupervisorConfig {
    listener_address: SocketAddr,
    state: EgressProxyState,
}

#[cfg(any(test, debug_assertions))]
enum EgressProxySupervisorCommand {
    ForceCurrentServerShutdown,
}

#[derive(Debug)]
struct ActiveEgressProxyServer {
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
    exit_receiver: mpsc::Receiver<Result<(), EgressProxyError>>,
}

enum DirectHttpUpstreamStream {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TransparentProxyProtocol {
    Empty,
    PlainHttp,
    Tls,
    Unsupported,
}

#[derive(Clone)]
struct EgressProxyRequestContext {
    sandbox_instance_id: String,
    request_id: String,
    method: String,
    authority: String,
    host: String,
    path_and_query: String,
    route_mode: &'static str,
    egress_rule_id: Option<String>,
    upstream_url: String,
    started_at_ms: u64,
    clock: Arc<dyn Clock>,
}

struct InstrumentedResponseBody {
    inner: HyperBody,
    context: Arc<EgressProxyRequestContext>,
    upstream_status: StatusCode,
    upstream_trace_id: Option<String>,
    chunk_count: u64,
    forwarded_bytes: u64,
    first_chunk_at_ms: Option<u64>,
    ended: bool,
}

impl EgressProxyError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for EgressProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EgressProxyError {}

impl DirectGatewayEgressClient {
    fn from_bootstrap_tunnel_url(
        tunnel_gateway_ws_url: &str,
        token_provider: GatewayEgressTokenProvider,
    ) -> Result<Self, EgressProxyError> {
        Ok(Self {
            http_route_url: resolve_direct_gateway_route_url(
                tunnel_gateway_ws_url,
                DIRECT_EGRESS_HTTP_ROUTE_PATH,
                DirectGatewayRouteScheme::Http,
            )?,
            websocket_route_url: resolve_direct_gateway_route_url(
                tunnel_gateway_ws_url,
                DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH,
                DirectGatewayRouteScheme::WebSocket,
            )?,
            token_provider,
        })
    }

    async fn token(&self) -> Result<String, EgressProxyError> {
        let token_provider = self.token_provider.clone();
        let token = tokio::task::spawn_blocking(move || token_provider.token())
            .await
            .map_err(|error| {
                EgressProxyError::new(format!("gateway egress token task failed: {error}"))
            })?
            .map_err(|error| EgressProxyError::new(error.to_string()))?;
        Ok(token.token)
    }

    fn direct_http_url(&self, target_url: &Uri) -> Result<Uri, EgressProxyError> {
        let mut route_url = self.http_route_url.clone();
        route_url
            .query_pairs_mut()
            .append_pair("target", &target_url.to_string());
        route_url.as_str().parse().map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway egress HTTP URL: {error}"
            ))
        })
    }

    fn direct_websocket_url(&self, target_url: &Uri) -> Result<String, EgressProxyError> {
        let mut route_url = self.websocket_route_url.clone();
        route_url
            .query_pairs_mut()
            .append_pair("target", &websocket_target_url(target_url)?);
        Ok(route_url.to_string())
    }
}

impl EgressProxyRequestContext {
    fn elapsed_ms(&self) -> u64 {
        self.clock.now_ms().saturating_sub(self.started_at_ms)
    }

    fn common_fields(&self) -> Vec<(&'static str, Value)> {
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

impl EgressProxy {
    pub fn start(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        gateway_egress_token_provider: Option<GatewayEgressTokenProvider>,
        clock: Arc<dyn Clock>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Option<Self>, EgressProxyError> {
        if runtime_plan.egress_routes.is_empty() && startup_input.transparent_proxy.is_none() {
            return Ok(None);
        };
        let Some(token_provider) = gateway_egress_token_provider else {
            return Err(EgressProxyError::new(
                "gateway egress token provider is required before starting sandbox egress proxy",
            ));
        };
        let forwarding_mode = EgressProxyForwardingMode::DirectGateway {
            client: Arc::new(DirectGatewayEgressClient::from_bootstrap_tunnel_url(
                &startup_input.tunnel_gateway_ws_url,
                token_provider,
            )?),
        };
        Self::start_with_options(
            runtime_plan,
            startup_input,
            forwarding_mode,
            default_loopback_proxy_listener_address(),
            ProxyCaConfig {
                runtime_certificate_path: Path::new(RUNTIME_PROXY_CA_CERT_PATH),
                runtime_certificate_bundle_path: Path::new(RUNTIME_PROXY_CA_BUNDLE_PATH),
                persistent_certificate_path: Path::new(PERSISTENT_PROXY_CA_CERT_PATH),
                persistent_private_key_path: Path::new(PERSISTENT_PROXY_CA_KEY_PATH),
                trust_store_certificate_path: Path::new(RUNTIME_PROXY_CA_TRUST_STORE_PATH),
                system_certificate_bundle_path: Path::new(SYSTEM_CA_CERT_BUNDLE_PATH),
                refresh_command: Path::new(UPDATE_CA_CERTIFICATES_COMMAND),
            },
            clock,
            supervisor_handle,
        )
    }

    fn start_with_options(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        forwarding_mode: EgressProxyForwardingMode,
        listener_address: SocketAddr,
        proxy_ca_config: ProxyCaConfig<'_>,
        clock: Arc<dyn Clock>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Option<Self>, EgressProxyError> {
        if runtime_plan.egress_routes.is_empty() && startup_input.transparent_proxy.is_none() {
            return Ok(None);
        }
        let log_clock = clock.clone();
        let log_context = EgressProxyLogContext {
            clock: log_clock.as_ref(),
            sandbox_instance_id: supervisor_handle.sandbox_instance_id(),
        };

        let routes = runtime_plan
            .egress_routes
            .iter()
            .map(build_gateway_egress_route)
            .collect::<Result<Vec<_>, _>>()?;

        let generated_proxy_ca =
            load_or_create_persistent_proxy_ca(proxy_ca_config, clock.as_ref(), log_context)?;
        let proxy_ca_installation = match ProxyCaInstallation::install(
            &generated_proxy_ca.certificate_pem,
            proxy_ca_config.runtime_certificate_path,
            proxy_ca_config.runtime_certificate_bundle_path,
            proxy_ca_config.trust_store_certificate_path,
            proxy_ca_config.system_certificate_bundle_path,
            proxy_ca_config.refresh_command,
            log_context,
        ) {
            Ok(proxy_ca_installation) => proxy_ca_installation,
            Err(error) => {
                emit_proxy_ca_lifecycle_log(
                    log_context,
                    "egress_proxy_ca_install_failed",
                    proxy_ca_config.runtime_certificate_path,
                    proxy_ca_config.trust_store_certificate_path,
                    proxy_ca_config.refresh_command,
                    Some(error.to_string()),
                );
                return Err(error);
            }
        };

        let std_listener = match bind_egress_proxy_listener(listener_address) {
            Ok(std_listener) => std_listener,
            Err(error) => {
                let cleanup_suffix =
                    cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                        .err()
                        .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                        .unwrap_or_default();
                return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
            }
        };
        let listener_address = match std_listener.local_addr() {
            Ok(listener_address) => listener_address,
            Err(error) => {
                let cleanup_suffix =
                    cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                        .err()
                        .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                        .unwrap_or_default();
                return Err(EgressProxyError::new(format!(
                    "failed to inspect local egress proxy address: {error}{cleanup_suffix}"
                )));
            }
        };
        supervisor_handle.replace_component_details(
            SupervisedComponent::EgressProxy,
            BTreeMap::from([
                ("listenAddr".to_string(), listener_address.to_string()),
                (
                    "stablePort".to_string(),
                    listener_address.port().to_string(),
                ),
            ]),
        );

        let routes = Arc::new(RwLock::new(routes));
        let state = EgressProxyState {
            sandbox_instance_id: supervisor_handle.sandbox_instance_id().to_string(),
            forwarding_mode: forwarding_mode.clone(),
            routes: routes.clone(),
            proxy_ca_certificate_pem: Arc::new(generated_proxy_ca.certificate_pem.clone()),
            proxy_ca_private_key_pem: Arc::new(generated_proxy_ca.private_key_pem),
            clock,
            next_request_id: Arc::new(AtomicU64::new(1)),
        };
        let transparent_listener_address = if startup_input.transparent_proxy.is_some() {
            transparent_proxy_listener_address_for_forwarding_mode(&forwarding_mode)?
        } else {
            None
        };

        let runtime_env =
            match build_managed_proxy_env(proxy_ca_config.runtime_certificate_bundle_path) {
                Ok(runtime_env) => runtime_env,
                Err(error) => {
                    let cleanup_suffix =
                        cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                            .err()
                            .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                            .unwrap_or_default();
                    return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
                }
            };

        supervisor_handle.mark_component_starting(SupervisedComponent::EgressProxy);
        let mut active_server =
            spawn_active_egress_proxy_server(std_listener, state.clone(), run_proxy_server);
        if let Err(error) = wait_for_egress_proxy_health(
            listener_address,
            &mut active_server,
            EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
        ) {
            active_server.request_shutdown();
            let _ = active_server.join();
            let cleanup_suffix = cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                .err()
                .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                .unwrap_or_default();
            return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
        }
        supervisor_handle.mark_component_healthy(SupervisedComponent::EgressProxy);

        let mut transparent_server = match transparent_listener_address {
            Some(transparent_listener_address) => {
                let transparent_listener =
                    match bind_transparent_egress_proxy_listener(transparent_listener_address) {
                        Ok(transparent_listener) => transparent_listener,
                        Err(error) => {
                            active_server.request_shutdown();
                            let _ = active_server.join();
                            let cleanup_suffix =
                                cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                                    .err()
                                    .map(|cleanup_error| {
                                        format!(" cleanup also failed: {cleanup_error}")
                                    })
                                    .unwrap_or_default();
                            return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
                        }
                    };
                let transparent_listener_address = match transparent_listener.local_addr() {
                    Ok(transparent_listener_address) => transparent_listener_address,
                    Err(error) => {
                        active_server.request_shutdown();
                        let _ = active_server.join();
                        let cleanup_suffix =
                            cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                                .err()
                                .map(|cleanup_error| {
                                    format!(" cleanup also failed: {cleanup_error}")
                                })
                                .unwrap_or_default();
                        return Err(EgressProxyError::new(format!(
                            "failed to inspect transparent egress proxy address: {error}{cleanup_suffix}"
                        )));
                    }
                };
                let mut transparent_server = spawn_active_egress_proxy_server(
                    transparent_listener,
                    state.clone(),
                    run_transparent_proxy_server,
                );
                if let Err(error) = wait_for_egress_proxy_health(
                    transparent_listener_address,
                    &mut transparent_server,
                    EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
                ) {
                    transparent_server.request_shutdown();
                    let _ = transparent_server.join();
                    active_server.request_shutdown();
                    let _ = active_server.join();
                    let cleanup_suffix =
                        cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                            .err()
                            .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                            .unwrap_or_default();
                    return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
                }
                emit_egress_proxy_log(
                    log_context.clock,
                    log_context.sandbox_instance_id,
                    "egress_proxy_transparent_listener_started",
                    &[(
                        "listenAddr",
                        Value::String(transparent_listener_address.to_string()),
                    )],
                );
                Some(transparent_server)
            }
            None => None,
        };

        let transparent_packet_rules = if transparent_server.is_some() {
            match startup_input.transparent_proxy.as_ref() {
                Some(configuration) => {
                    match TransparentPacketRules::install(
                        configuration,
                        DEFAULT_TRANSPARENT_PROXY_PORT,
                    ) {
                        Ok(packet_rules) => {
                            emit_egress_proxy_log(
                                log_context.clock,
                                log_context.sandbox_instance_id,
                                "egress_proxy_transparent_packet_rules_installed",
                                &[
                                    (
                                        "tableName",
                                        Value::String(TRANSPARENT_NFTABLES_TABLE_NAME.to_string()),
                                    ),
                                    (
                                        "localDestinationIpv4Cidrs",
                                        Value::Array(
                                            packet_rules
                                                .local_destination_ipv4_cidrs
                                                .iter()
                                                .cloned()
                                                .map(Value::String)
                                                .collect(),
                                        ),
                                    ),
                                    (
                                        "excludedIpv4Cidrs",
                                        Value::Array(
                                            packet_rules
                                                .excluded_ipv4_cidrs
                                                .iter()
                                                .cloned()
                                                .map(Value::String)
                                                .collect(),
                                        ),
                                    ),
                                ],
                            );
                            Some(packet_rules)
                        }
                        Err(error) => {
                            if let Some(mut server) = transparent_server.take() {
                                server.request_shutdown();
                                let _ = server.join();
                            }
                            active_server.request_shutdown();
                            let _ = active_server.join();
                            let cleanup_suffix =
                                cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                                    .err()
                                    .map(|cleanup_error| {
                                        format!(" cleanup also failed: {cleanup_error}")
                                    })
                                    .unwrap_or_default();
                            return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
                        }
                    }
                }
                None => None,
            }
        } else {
            None
        };

        let shutdown_requested = Arc::new(AtomicBool::new(false));
        #[cfg(any(test, debug_assertions))]
        let (supervisor_command_sender, supervisor_command_receiver) = mpsc::channel();
        let supervisor_thread = thread::spawn({
            let shutdown_requested = shutdown_requested.clone();
            let supervisor_handle = supervisor_handle.clone();
            let config = EgressProxySupervisorConfig {
                listener_address,
                state,
            };
            move || {
                run_egress_proxy_supervisor(
                    config,
                    active_server,
                    shutdown_requested,
                    supervisor_handle,
                    #[cfg(any(test, debug_assertions))]
                    supervisor_command_receiver,
                )
            }
        });

        Ok(Some(Self {
            runtime_env,
            shutdown_requested,
            supervisor_thread: Some(supervisor_thread),
            transparent_server,
            #[cfg(any(test, debug_assertions))]
            supervisor_command_sender: Some(supervisor_command_sender),
            proxy_ca_installation,
            transparent_packet_rules,
            supervisor_handle,
        }))
    }

    pub fn runtime_env(&self) -> &BTreeMap<String, String> {
        &self.runtime_env
    }

    pub fn managed_env_keys() -> &'static [&'static str] {
        &MANAGED_PROXY_ENV_KEYS
    }

    #[cfg(any(test, debug_assertions))]
    pub(crate) fn force_current_server_shutdown_for_test(&self) -> Result<(), EgressProxyError> {
        let supervisor_command_sender =
            self.supervisor_command_sender.as_ref().ok_or_else(|| {
                EgressProxyError::new(
                    "egress proxy fault injection is unavailable in this build or runtime mode",
                )
            })?;
        supervisor_command_sender
            .send(EgressProxySupervisorCommand::ForceCurrentServerShutdown)
            .map_err(|_| {
                EgressProxyError::new("egress proxy supervisor command channel is unavailable")
            })
    }

    pub fn close(mut self) -> Result<(), EgressProxyError> {
        let log_context = EgressProxyLogContext {
            clock: &SystemClock,
            sandbox_instance_id: self.supervisor_handle.sandbox_instance_id(),
        };
        self.shutdown_requested.store(true, Ordering::Relaxed);

        let packet_rules_cleanup_result = self
            .transparent_packet_rules
            .take()
            .map(|packet_rules| packet_rules.cleanup());

        if let Some(supervisor_thread) = self.supervisor_thread.take() {
            match supervisor_thread.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => return Err(error),
                Err(_) => {
                    return Err(EgressProxyError::new(
                        "egress proxy supervisor thread panicked",
                    ));
                }
            }
        }

        if let Some(mut transparent_server) = self.transparent_server.take() {
            transparent_server.request_shutdown();
            transparent_server.join()?;
        }

        if let Some(cleanup_result) = packet_rules_cleanup_result {
            cleanup_result?;
        }
        cleanup_proxy_ca_installation(&self.proxy_ca_installation, log_context)?;

        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::EgressProxy);

        Ok(())
    }
}

fn default_loopback_proxy_listener_address() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], DEFAULT_LOOPBACK_PROXY_PORT))
}

fn spawn_active_egress_proxy_server(
    std_listener: StdTcpListener,
    state: EgressProxyState,
    server_runner: fn(
        StdTcpListener,
        oneshot::Receiver<()>,
        EgressProxyState,
    ) -> Result<(), EgressProxyError>,
) -> ActiveEgressProxyServer {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (exit_sender, exit_receiver) = mpsc::channel();
    let server_thread = thread::spawn(move || {
        let result = server_runner(std_listener, shutdown_rx, state);
        let _ = exit_sender.send(result.clone());
        result
    });
    ActiveEgressProxyServer {
        shutdown_tx: Some(shutdown_tx),
        server_thread: Some(server_thread),
        exit_receiver,
    }
}

impl ActiveEgressProxyServer {
    fn request_shutdown(&mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
    }

    fn try_recv_exit(&self) -> Result<Option<Result<(), EgressProxyError>>, TryRecvError> {
        match self.exit_receiver.try_recv() {
            Ok(result) => Ok(Some(result)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(TryRecvError::Disconnected),
        }
    }

    fn join(mut self) -> Result<(), EgressProxyError> {
        if let Some(server_thread) = self.server_thread.take() {
            return match server_thread.join() {
                Ok(result) => result,
                Err(_) => Err(EgressProxyError::new("local egress proxy thread panicked")),
            };
        }
        Ok(())
    }

    fn join_after_disconnected_exit_channel(&mut self) -> EgressProxyError {
        self.shutdown_tx = None;
        match self.server_thread.take() {
            Some(server_thread) => match server_thread.join() {
                Ok(Ok(())) => EgressProxyError::new(
                    "local egress proxy exit channel disconnected unexpectedly",
                ),
                Ok(Err(error)) => error,
                Err(_) => EgressProxyError::new("local egress proxy thread panicked"),
            },
            None => {
                EgressProxyError::new("local egress proxy exit channel disconnected unexpectedly")
            }
        }
    }
}

fn run_egress_proxy_supervisor(
    config: EgressProxySupervisorConfig,
    mut active_server: ActiveEgressProxyServer,
    shutdown_requested: Arc<AtomicBool>,
    supervisor_handle: SandboxdSupervisorHandle,
    #[cfg(any(test, debug_assertions))] supervisor_command_receiver: mpsc::Receiver<
        EgressProxySupervisorCommand,
    >,
) -> Result<(), EgressProxyError> {
    let mut restart_attempt_index = 0_usize;

    loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            active_server.request_shutdown();
            return active_server.join();
        }

        #[cfg(any(test, debug_assertions))]
        match supervisor_command_receiver.try_recv() {
            Ok(EgressProxySupervisorCommand::ForceCurrentServerShutdown) => {
                active_server.request_shutdown();
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {}
        }

        let exit_result = match active_server.try_recv_exit() {
            Ok(Some(exit_result)) => Some(exit_result),
            Ok(None) => None,
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                Some(Err(active_server.join_after_disconnected_exit_channel()))
            }
        };

        if let Some(exit_result) = exit_result {
            let exit_error = normalize_egress_proxy_exit_result(exit_result);
            record_egress_proxy_exit_for_restart(&supervisor_handle, &exit_error);
            active_server = match restart_egress_proxy_after_backoff(
                &config,
                shutdown_requested.as_ref(),
                &supervisor_handle,
                &mut restart_attempt_index,
            ) {
                Ok(active_server) => active_server,
                Err(_) if shutdown_requested.load(Ordering::Relaxed) => return Ok(()),
                Err(error) => return Err(error),
            };
            continue;
        }

        if let Err(error) = check_egress_proxy_health(config.listener_address) {
            record_egress_proxy_healthcheck_failure(&supervisor_handle, &error);
            active_server.request_shutdown();
            let _ = active_server.join();
            active_server = match restart_egress_proxy_after_backoff(
                &config,
                shutdown_requested.as_ref(),
                &supervisor_handle,
                &mut restart_attempt_index,
            ) {
                Ok(active_server) => active_server,
                Err(_) if shutdown_requested.load(Ordering::Relaxed) => return Ok(()),
                Err(error) => return Err(error),
            };
            continue;
        }

        supervisor_handle.record_component_healthcheck(SupervisedComponent::EgressProxy);
        thread::sleep(EGRESS_PROXY_HEALTHCHECK_INTERVAL);
    }
}

fn restart_egress_proxy_after_backoff(
    config: &EgressProxySupervisorConfig,
    shutdown_requested: &AtomicBool,
    supervisor_handle: &SandboxdSupervisorHandle,
    restart_attempt_index: &mut usize,
) -> Result<ActiveEgressProxyServer, EgressProxyError> {
    loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            return Err(EgressProxyError::new(
                "egress proxy supervisor shutdown requested",
            ));
        }

        let backoff_ms = egress_proxy_restart_backoff_ms(*restart_attempt_index);
        supervisor_handle.emit_component_restart_scheduled(
            SupervisedComponent::EgressProxy,
            "restart_after_failure",
            backoff_ms,
            &[],
        );
        thread::sleep(Duration::from_millis(backoff_ms));
        if shutdown_requested.load(Ordering::Relaxed) {
            return Err(EgressProxyError::new(
                "egress proxy supervisor shutdown requested",
            ));
        }

        supervisor_handle.mark_component_starting(SupervisedComponent::EgressProxy);
        let std_listener = match bind_egress_proxy_listener(config.listener_address) {
            Ok(std_listener) => std_listener,
            Err(error_message) => {
                let error = EgressProxyError::new(error_message);
                record_egress_proxy_healthcheck_failure(supervisor_handle, &error);
                *restart_attempt_index = restart_attempt_index.saturating_add(1);
                continue;
            }
        };
        let mut active_server =
            spawn_active_egress_proxy_server(std_listener, config.state.clone(), run_proxy_server);
        match wait_for_egress_proxy_health(
            config.listener_address,
            &mut active_server,
            EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
        ) {
            Ok(()) => {
                supervisor_handle.mark_component_healthy(SupervisedComponent::EgressProxy);
                *restart_attempt_index = restart_attempt_index.saturating_add(1);
                return Ok(active_server);
            }
            Err(error) => {
                record_egress_proxy_healthcheck_failure(supervisor_handle, &error);
                active_server.request_shutdown();
                let _ = active_server.join();
                *restart_attempt_index = restart_attempt_index.saturating_add(1);
            }
        }
    }
}

fn normalize_egress_proxy_exit_result(
    exit_result: Result<(), EgressProxyError>,
) -> EgressProxyError {
    match exit_result {
        Ok(()) => EgressProxyError::new("local egress proxy thread returned unexpectedly"),
        Err(error) => error,
    }
}

fn wait_for_egress_proxy_health(
    listener_address: SocketAddr,
    active_server: &mut ActiveEgressProxyServer,
    timeout: Duration,
) -> Result<(), EgressProxyError> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(exit_result) = active_server
            .try_recv_exit()
            .map_err(|_| EgressProxyError::new("egress proxy exit channel disconnected"))?
        {
            return match exit_result {
                Ok(()) => Err(EgressProxyError::new(
                    "local egress proxy thread returned before becoming healthy",
                )),
                Err(error) => Err(error),
            };
        }

        if check_egress_proxy_health(listener_address).is_ok() {
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err(EgressProxyError::new(format!(
                "egress proxy healthcheck timed out for {listener_address}"
            )));
        }

        thread::sleep(Duration::from_millis(50));
    }
}

fn check_egress_proxy_health(listener_address: SocketAddr) -> Result<(), EgressProxyError> {
    std::net::TcpStream::connect_timeout(&listener_address, Duration::from_millis(200))
        .map(|_| ())
        .map_err(|error| EgressProxyError::new(format!("loopback tcp healthcheck failed: {error}")))
}

fn record_egress_proxy_healthcheck_failure(
    supervisor_handle: &SandboxdSupervisorHandle,
    error: &EgressProxyError,
) {
    supervisor_handle
        .mark_component_restarting(SupervisedComponent::EgressProxy, error.to_string());
    supervisor_handle.emit_component_healthcheck_failed(
        SupervisedComponent::EgressProxy,
        "loopback_tcp_failed",
        error.to_string(),
        "loopback_tcp",
        &[],
    );
}

fn record_egress_proxy_exit_for_restart(
    supervisor_handle: &SandboxdSupervisorHandle,
    error: &EgressProxyError,
) {
    let error_text = error.to_string();
    if error_text.contains("panicked") {
        supervisor_handle
            .mark_component_restarting(SupervisedComponent::EgressProxy, error_text.clone());
        supervisor_handle.emit_component_exited(
            SupervisedComponent::EgressProxy,
            "panic",
            Some(&error_text),
            &[
                ("exitKind", Value::String("panic".to_string())),
                ("panicBoundary", Value::String("proxy_thread".to_string())),
            ],
        );
        return;
    }

    supervisor_handle
        .mark_component_restarting(SupervisedComponent::EgressProxy, error_text.clone());
    supervisor_handle.emit_component_exited(
        SupervisedComponent::EgressProxy,
        "thread_returned",
        Some(&error_text),
        &[("exitKind", Value::String("thread_returned".to_string()))],
    );
}

fn egress_proxy_restart_backoff_ms(attempt_index: usize) -> u64 {
    *EGRESS_PROXY_RESTART_BACKOFF_MS
        .get(attempt_index)
        .unwrap_or_else(|| {
            EGRESS_PROXY_RESTART_BACKOFF_MS
                .last()
                .expect("egress proxy backoff list should not be empty")
        })
}

fn bind_egress_proxy_listener(listener_address: SocketAddr) -> Result<StdTcpListener, String> {
    let std_listener = StdTcpListener::bind(listener_address)
        .map_err(|error| format!("failed to bind local egress proxy listener: {error}"))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure proxy listener: {error}"))?;
    Ok(std_listener)
}

fn bind_transparent_egress_proxy_listener(
    listener_address: SocketAddr,
) -> Result<StdTcpListener, String> {
    let std_listener = StdTcpListener::bind(listener_address).map_err(|error| {
        format!("failed to bind transparent egress proxy listener {listener_address}: {error}")
    })?;
    std_listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure transparent proxy listener: {error}"))?;
    Ok(std_listener)
}

#[derive(Clone, Copy)]
enum DirectGatewayRouteScheme {
    Http,
    WebSocket,
}

fn resolve_direct_gateway_route_url(
    tunnel_gateway_ws_url: &str,
    route_path: &str,
    route_scheme: DirectGatewayRouteScheme,
) -> Result<Url, EgressProxyError> {
    let mut route_url = Url::parse(tunnel_gateway_ws_url).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse sandbox tunnel gateway ws url for direct egress: {error}"
        ))
    })?;
    route_url
        .set_scheme(match (route_url.scheme(), route_scheme) {
            ("ws", DirectGatewayRouteScheme::Http) => "http",
            ("wss", DirectGatewayRouteScheme::Http) => "https",
            ("ws", DirectGatewayRouteScheme::WebSocket) => "ws",
            ("wss", DirectGatewayRouteScheme::WebSocket) => "wss",
            (scheme, _) => {
                return Err(EgressProxyError::new(format!(
                    "sandbox tunnel gateway ws url must use ws or wss scheme, got '{scheme}'"
                )));
            }
        })
        .map_err(|_| {
            EgressProxyError::new(
                "failed to set direct gateway egress route URL scheme".to_string(),
            )
        })?;
    route_url.set_path(route_path);
    Ok(route_url)
}

fn build_managed_proxy_env(
    ca_certificate_path: &Path,
) -> Result<BTreeMap<String, String>, EgressProxyError> {
    let certificate_path = ca_certificate_path.display().to_string();

    Ok(BTreeMap::from([
        ("SSL_CERT_FILE".to_string(), certificate_path.clone()),
        ("CURL_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("GIT_SSL_CAINFO".to_string(), certificate_path.clone()),
        ("REQUESTS_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("NODE_EXTRA_CA_CERTS".to_string(), certificate_path.clone()),
        ("NIX_SSL_CERT_FILE".to_string(), certificate_path),
    ]))
}

fn transparent_proxy_listener_address_for_forwarding_mode(
    forwarding_mode: &EgressProxyForwardingMode,
) -> Result<Option<SocketAddr>, EgressProxyError> {
    match forwarding_mode {
        EgressProxyForwardingMode::DirectGateway { .. } => {
            #[cfg(target_os = "linux")]
            {
                Ok(Some(default_transparent_proxy_listener_address()))
            }
            #[cfg(not(target_os = "linux"))]
            {
                Err(EgressProxyError::new(
                    "transparent gateway egress requires Linux SO_ORIGINAL_DST support",
                ))
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn default_transparent_proxy_listener_address() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], DEFAULT_TRANSPARENT_PROXY_PORT))
}

fn run_proxy_server(
    std_listener: StdTcpListener,
    mut shutdown_rx: oneshot::Receiver<()>,
    state: EgressProxyState,
) -> Result<(), EgressProxyError> {
    let runtime = Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to start local egress proxy runtime: {error}"
            ))
        })?;

    runtime.block_on(async move {
        let listener = TcpListener::from_std(std_listener).map_err(|error| {
            EgressProxyError::new(format!("failed to create local egress proxy listener: {error}"))
        })?;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => return Ok(()),
                accept_result = listener.accept() => {
                    let (stream, _) = accept_result.map_err(|error| {
                        EgressProxyError::new(format!("local egress proxy accept failed: {error}"))
                    })?;
                    let state = state.clone();
                    tokio::spawn(async move {
                        let io = TokioIo::new(stream);
                        let service = service_fn(move |request| handle_proxy_request(request, state.clone(), None));
                        let connection = http1::Builder::new().serve_connection(io, service).with_upgrades();
                        let _ = connection.await;
                    });
                }
            }
        }
    })
}

fn run_transparent_proxy_server(
    std_listener: StdTcpListener,
    mut shutdown_rx: oneshot::Receiver<()>,
    state: EgressProxyState,
) -> Result<(), EgressProxyError> {
    let runtime = Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to start transparent egress proxy runtime: {error}"
            ))
        })?;

    runtime.block_on(async move {
        let listener = TcpListener::from_std(std_listener).map_err(|error| {
            EgressProxyError::new(format!(
                "failed to create transparent egress proxy listener: {error}"
            ))
        })?;

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => return Ok(()),
                accept_result = listener.accept() => {
                    let (stream, peer_address) = accept_result.map_err(|error| {
                        EgressProxyError::new(format!("transparent egress proxy accept failed: {error}"))
                    })?;
                    let state = state.clone();
                    tokio::spawn(async move {
                        let log_state = state.clone();
                        if let Err(error) = handle_transparent_proxy_connection(stream, peer_address, state).await {
                            emit_egress_proxy_log(
                                log_state.clock.as_ref(),
                                &log_state.sandbox_instance_id,
                                "egress_proxy_transparent_connection_failed",
                                &[
                                    ("peerAddr", Value::String(peer_address.to_string())),
                                    ("error", Value::String(error.to_string())),
                                ],
                            );
                        }
                    });
                }
            }
        }
    })
}

async fn handle_transparent_proxy_connection(
    stream: TcpStream,
    peer_address: SocketAddr,
    state: EgressProxyState,
) -> Result<(), EgressProxyError> {
    let original_destination = recover_original_destination(&stream)?;
    let authority = original_destination.to_string();
    let protocol = classify_transparent_proxy_stream(&stream).await?;
    let mut fields = vec![
        ("peerAddr", Value::String(peer_address.to_string())),
        (
            "originalDestination",
            Value::String(original_destination.to_string()),
        ),
        (
            "detectedProtocol",
            Value::String(transparent_proxy_protocol_name(protocol).to_string()),
        ),
    ];
    match protocol {
        TransparentProxyProtocol::Empty => {
            emit_egress_proxy_log(
                state.clock.as_ref(),
                &state.sandbox_instance_id,
                "egress_proxy_transparent_connection_empty",
                &fields,
            );
            Ok(())
        }
        TransparentProxyProtocol::PlainHttp => {
            fields.push(("scheme", Value::String("http".to_string())));
            fields.push(("authority", Value::String(authority.clone())));
            emit_egress_proxy_log(
                state.clock.as_ref(),
                &state.sandbox_instance_id,
                "egress_proxy_transparent_connection_started",
                &fields,
            );
            let target_override = RequestTargetOverride {
                scheme: "http",
                default_authority: authority,
            };
            let service = service_fn(move |request| {
                handle_proxy_request(request, state.clone(), Some(target_override.clone()))
            });
            http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .with_upgrades()
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "transparent plaintext HTTP connection failed: {error}"
                    ))
                })
        }
        TransparentProxyProtocol::Tls => {
            fields.push(("scheme", Value::String("https".to_string())));
            fields.push(("authority", Value::String(authority.clone())));
            emit_egress_proxy_log(
                state.clock.as_ref(),
                &state.sandbox_instance_id,
                "egress_proxy_transparent_connection_started",
                &fields,
            );
            let tls_stream =
                accept_transparent_tls_stream(stream, &authority, state.clone()).await?;
            let target_override = RequestTargetOverride {
                scheme: "https",
                default_authority: authority,
            };
            let service = service_fn(move |request| {
                handle_proxy_request(request, state.clone(), Some(target_override.clone()))
            });
            http1::Builder::new()
                .serve_connection(TokioIo::new(tls_stream), service)
                .with_upgrades()
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "transparent TLS HTTP connection failed: {error}"
                    ))
                })
        }
        TransparentProxyProtocol::Unsupported => {
            handle_transparent_passthrough_connection(stream, original_destination, state, fields)
                .await
        }
    }
}

async fn classify_transparent_proxy_stream(
    stream: &TcpStream,
) -> Result<TransparentProxyProtocol, EgressProxyError> {
    let mut first_byte = [0_u8; 1];
    let byte_count = stream.peek(&mut first_byte).await.map_err(|error| {
        EgressProxyError::new(format!(
            "failed to inspect transparent egress proxy connection: {error}"
        ))
    })?;
    if byte_count == 0 {
        // The supervisor health check opens and closes a TCP connection without
        // sending bytes; treat that as healthy listener traffic, not passthrough.
        return Ok(TransparentProxyProtocol::Empty);
    }
    Ok(classify_transparent_proxy_first_byte(first_byte[0]))
}

fn classify_transparent_proxy_first_byte(first_byte: u8) -> TransparentProxyProtocol {
    match first_byte {
        0x16 => TransparentProxyProtocol::Tls,
        b'A' | b'C' | b'D' | b'G' | b'H' | b'O' | b'P' | b'T' => {
            TransparentProxyProtocol::PlainHttp
        }
        _ => TransparentProxyProtocol::Unsupported,
    }
}

fn transparent_proxy_protocol_name(protocol: TransparentProxyProtocol) -> &'static str {
    match protocol {
        TransparentProxyProtocol::Empty => "empty",
        TransparentProxyProtocol::PlainHttp => "http",
        TransparentProxyProtocol::Tls => "tls",
        TransparentProxyProtocol::Unsupported => "unsupported",
    }
}

async fn handle_transparent_passthrough_connection(
    mut downstream: TcpStream,
    original_destination: SocketAddr,
    state: EgressProxyState,
    fields: Vec<(&'static str, Value)>,
) -> Result<(), EgressProxyError> {
    emit_egress_proxy_log(
        state.clock.as_ref(),
        &state.sandbox_instance_id,
        "egress_proxy_transparent_passthrough_started",
        &fields,
    );

    let started_at_ms = state.clock.now_ms();
    let mut upstream = connect_transparent_passthrough_upstream(original_destination).await?;
    let copy_result = copy_bidirectional(&mut downstream, &mut upstream)
        .await
        .map_err(|error| {
            EgressProxyError::new(format!(
                "transparent passthrough copy to '{original_destination}' failed: {error}"
            ))
        })?;

    let ended_at_ms = state.clock.now_ms();
    let duration_ms = ended_at_ms.saturating_sub(started_at_ms);
    let mut completed_fields = fields;
    completed_fields.push(("outcome", Value::String("completed".to_string())));
    completed_fields.push(("requestBytes", Value::from(copy_result.0)));
    completed_fields.push(("responseBytes", Value::from(copy_result.1)));
    completed_fields.push(("durationMs", Value::from(duration_ms)));
    emit_egress_proxy_log(
        state.clock.as_ref(),
        &state.sandbox_instance_id,
        "egress_proxy_transparent_passthrough_completed",
        &completed_fields,
    );

    Ok(())
}

async fn connect_transparent_passthrough_upstream(
    original_destination: SocketAddr,
) -> Result<TcpStream, EgressProxyError> {
    let socket = match original_destination {
        SocketAddr::V4(_) => TcpSocket::new_v4(),
        SocketAddr::V6(_) => TcpSocket::new_v6(),
    }
    .map_err(|error| {
        EgressProxyError::new(format!(
            "failed to create transparent passthrough upstream socket: {error}"
        ))
    })?;

    configure_transparent_passthrough_upstream_socket(&socket)?;
    socket.connect(original_destination).await.map_err(|error| {
        EgressProxyError::new(format!(
            "failed to connect transparent passthrough upstream '{original_destination}': {error}"
        ))
    })
}

async fn handle_proxy_request(
    mut request: Request<Incoming>,
    state: EgressProxyState,
    target_override: Option<RequestTargetOverride>,
) -> Result<Response<HyperBody>, Infallible> {
    if request.method() == Method::CONNECT {
        return Ok(handle_connect_request(request, state));
    }

    if is_websocket_upgrade_request(&request) {
        let downstream_upgrade = hyper::upgrade::on(&mut request);
        return Ok(
            match forward_upgrade_request(request, state, target_override, downstream_upgrade).await
            {
                Ok(response) => response,
                Err(error) => text_response(StatusCode::BAD_GATEWAY, error.to_string()),
            },
        );
    }

    Ok(
        match forward_request(request, state, target_override).await {
            Ok(response) => response,
            Err(error) => text_response(StatusCode::BAD_GATEWAY, error.to_string()),
        },
    )
}

fn is_websocket_upgrade_request(request: &Request<Incoming>) -> bool {
    let has_upgrade_token = request
        .headers()
        .get(hyper::header::CONNECTION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
        });
    let upgrades_to_websocket = request
        .headers()
        .get(hyper::header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));

    has_upgrade_token && upgrades_to_websocket
}

fn handle_connect_request(
    request: Request<Incoming>,
    state: EgressProxyState,
) -> Response<HyperBody> {
    let Some(authority) = request
        .uri()
        .authority()
        .map(|authority| authority.as_str().to_string())
    else {
        return text_response(
            StatusCode::BAD_REQUEST,
            "CONNECT requests must include a target authority",
        );
    };

    tokio::spawn(async move {
        let Ok(upgraded) = hyper::upgrade::on(request).await else {
            return;
        };
        let Ok(tls_acceptor) = build_tls_acceptor(
            &authority,
            state.proxy_ca_certificate_pem.as_str(),
            state.proxy_ca_private_key_pem.as_str(),
            state.clock.as_ref(),
        ) else {
            return;
        };
        let Ok(tls_stream) = tls_acceptor.accept(TokioIo::new(upgraded)).await else {
            return;
        };
        let target_override = RequestTargetOverride {
            scheme: "https",
            default_authority: authority,
        };
        let service = service_fn(move |request| {
            handle_proxy_request(request, state.clone(), Some(target_override.clone()))
        });
        let _ = http1::Builder::new()
            .serve_connection(TokioIo::new(tls_stream), service)
            .with_upgrades()
            .await;
    });

    Response::builder()
        .status(StatusCode::OK)
        .body(empty_body())
        .expect("CONNECT acknowledgement response should build")
}

async fn forward_upgrade_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    target_override: Option<RequestTargetOverride>,
    downstream_upgrade: hyper::upgrade::OnUpgrade,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let (parts, _) = request.into_parts();
    let request_method = parts.method.clone();
    let mark_upstream_socket = target_override.is_some();
    let request_target = resolve_request_target(&parts, target_override.as_ref())?;
    let request_path_and_query = request_target
        .uri
        .path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str())
        .to_string();
    let route = match_state_route(
        &state,
        &request_target.host,
        &request_path_and_query,
        request_method.as_str(),
    )?;
    if route.is_none() {
        return forward_upgrade_request_direct(
            parts,
            state,
            request_target,
            request_path_and_query,
            downstream_upgrade,
            mark_upstream_socket,
        )
        .await;
    }
    match state.forwarding_mode.clone() {
        EgressProxyForwardingMode::DirectGateway { client } => {
            forward_upgrade_request_through_direct_gateway(
                parts,
                state,
                request_target,
                request_path_and_query,
                route,
                client,
                downstream_upgrade,
            )
            .await
        }
    }
}

async fn forward_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    target_override: Option<RequestTargetOverride>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let (parts, body) = request.into_parts();
    let request_method = parts.method.clone();
    let mark_upstream_socket = target_override.is_some();
    let request_target = resolve_request_target(&parts, target_override.as_ref())?;
    let request_path_and_query = request_target
        .uri
        .path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str())
        .to_string();
    let route = match_state_route(
        &state,
        &request_target.host,
        &request_path_and_query,
        request_method.as_str(),
    )?;
    let Some(route) = route else {
        return forward_request_direct(
            parts,
            body,
            state,
            request_target,
            request_path_and_query,
            mark_upstream_socket,
        )
        .await;
    };
    match state.forwarding_mode.clone() {
        EgressProxyForwardingMode::DirectGateway { client } => {
            forward_request_through_direct_gateway(
                parts,
                body,
                state,
                request_target,
                request_path_and_query,
                Some(route),
                client,
            )
            .await
        }
    }
}

async fn forward_upgrade_request_direct(
    parts: hyper::http::request::Parts,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    downstream_upgrade: hyper::upgrade::OnUpgrade,
    mark_upstream_socket: bool,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query,
        route_mode: "direct",
        egress_rule_id: None,
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push(("upgrade", Value::String("websocket".to_string())));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upgrade_started",
        &request_started_fields,
    );

    let websocket_accept_key = parts
        .headers
        .get("sec-websocket-key")
        .map(|value| derive_accept_key(value.as_bytes()))
        .ok_or_else(|| {
            EgressProxyError::new("websocket upgrade request is missing Sec-WebSocket-Key")
        })?;
    let upstream_socket =
        match connect_direct_upstream_websocket(&request_target.uri, mark_upstream_socket).await {
            Ok(socket) => socket,
            Err(error) => {
                let mut fields = request_context.common_fields();
                fields.push(("outcome", Value::String("connect_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    request_context.clock.as_ref(),
                    &request_context.sandbox_instance_id,
                    "egress_proxy_upgrade_failed",
                    &fields,
                );
                return Err(error);
            }
        };

    let tunnel_context = request_context.clone();
    tokio::spawn(async move {
        let tunnel_result = tunnel_websocket_upgrade(downstream_upgrade, upstream_socket).await;

        match tunnel_result {
            Ok(()) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("completed".to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_completed",
                    &fields,
                );
            }
            Err(error) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("tunnel_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_failed",
                    &fields,
                );
            }
        }
    });

    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-accept", websocket_accept_key)
        .header(
            SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
            request_context.request_id.as_str(),
        )
        .body(empty_body())
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct websocket upgrade response: {error}"
            ))
        })
}

async fn forward_request_direct(
    parts: hyper::http::request::Parts,
    body: Incoming,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    mark_upstream_socket: bool,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query.clone(),
        route_mode: "direct",
        egress_rule_id: None,
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push((
        "hasRequestBody",
        Value::Bool(body.size_hint().lower() > 0 || body.size_hint().upper().unwrap_or(1) > 0),
    ));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_request_started",
        &request_started_fields,
    );

    let direct_response =
        match send_direct_upstream_http_request(parts, body, &request_target, mark_upstream_socket)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                let mut fields = request_context.common_fields();
                fields.push(("outcome", Value::String("connect_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    request_context.clock.as_ref(),
                    &request_context.sandbox_instance_id,
                    "egress_proxy_request_failed",
                    &fields,
                );
                return Err(error);
            }
        };

    response_from_direct_upstream_response(direct_response, request_context)
}

async fn forward_upgrade_request_through_direct_gateway(
    parts: hyper::http::request::Parts,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    route: Option<EgressProxyRoute>,
    client: Arc<DirectGatewayEgressClient>,
    downstream_upgrade: hyper::upgrade::OnUpgrade,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query,
        route_mode: "direct_gateway",
        egress_rule_id: route
            .as_ref()
            .map(|matched_route| matched_route.egress_rule_id.clone()),
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push(("upgrade", Value::String("websocket".to_string())));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upgrade_started",
        &request_started_fields,
    );

    let token = client.token().await?;
    let websocket_accept_key = parts
        .headers
        .get("sec-websocket-key")
        .map(|value| derive_accept_key(value.as_bytes()))
        .ok_or_else(|| {
            EgressProxyError::new("websocket upgrade request is missing Sec-WebSocket-Key")
        })?;
    let mut gateway_request = client
        .direct_websocket_url(&request_target.uri)?
        .into_client_request()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway websocket request: {error}"
            ))
        })?;
    gateway_request.headers_mut().insert(
        HeaderName::from_static(DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME),
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build egress authorization header: {error}"
            ))
        })?,
    );

    let (gateway_socket, _) = match connect_async(gateway_request).await {
        Ok(connection) => connection,
        Err(error) => {
            let mut fields = request_context.common_fields();
            fields.push(("outcome", Value::String("connect_failed".to_string())));
            fields.push(("error", Value::String(error.to_string())));
            emit_egress_proxy_log(
                request_context.clock.as_ref(),
                &request_context.sandbox_instance_id,
                "egress_proxy_upgrade_failed",
                &fields,
            );
            return Err(EgressProxyError::new(format!(
                "direct gateway websocket egress failed: {error}"
            )));
        }
    };

    let tunnel_context = request_context.clone();
    tokio::spawn(async move {
        let tunnel_result = tunnel_direct_gateway_upgrade(downstream_upgrade, gateway_socket).await;

        match tunnel_result {
            Ok(()) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("completed".to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_completed",
                    &fields,
                );
            }
            Err(error) => {
                let mut fields = tunnel_context.common_fields();
                fields.push(("outcome", Value::String("tunnel_failed".to_string())));
                fields.push(("error", Value::String(error.to_string())));
                emit_egress_proxy_log(
                    tunnel_context.clock.as_ref(),
                    &tunnel_context.sandbox_instance_id,
                    "egress_proxy_upgrade_failed",
                    &fields,
                );
            }
        }
    });

    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-accept", websocket_accept_key)
        .header(
            SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
            request_context.request_id.as_str(),
        )
        .body(empty_body())
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway websocket upgrade response: {error}"
            ))
        })
}

async fn forward_request_through_direct_gateway(
    parts: hyper::http::request::Parts,
    body: Incoming,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    route: Option<EgressProxyRoute>,
    client: Arc<DirectGatewayEgressClient>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let request_method = parts.method.clone();
    let request_context = Arc::new(EgressProxyRequestContext {
        sandbox_instance_id: state.sandbox_instance_id.clone(),
        request_id: format!(
            "egp_{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        method: request_method.to_string(),
        authority: request_target.authority.clone(),
        host: request_target.host.clone(),
        path_and_query: request_path_and_query.clone(),
        route_mode: "direct_gateway",
        egress_rule_id: route
            .as_ref()
            .map(|matched_route| matched_route.egress_rule_id.clone()),
        upstream_url: request_target.uri.to_string(),
        started_at_ms: state.clock.now_ms(),
        clock: state.clock.clone(),
    });
    let mut request_started_fields = request_context.common_fields();
    request_started_fields.push((
        "hasRequestBody",
        Value::Bool(body.size_hint().lower() > 0 || body.size_hint().upper().unwrap_or(1) > 0),
    ));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_request_started",
        &request_started_fields,
    );

    let token = client.token().await?;
    let direct_uri = client.direct_http_url(&request_target.uri)?;
    let mut request_builder = Request::builder()
        .method(request_method)
        .uri(direct_uri.clone())
        .header(
            DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME,
            format!("Bearer {token}"),
        );
    for (header_name, header_value) in filter_direct_gateway_request_headers(&parts.headers) {
        request_builder = request_builder.header(header_name, header_value);
    }
    let direct_request = request_builder
        .body(box_body(body.map_err(box_hyper_error)))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway egress request: {error}"
            ))
        })?;
    let gateway_response = match send_direct_gateway_http_request(direct_request, &direct_uri).await
    {
        Ok(response) => response,
        Err(error) => {
            let mut fields = request_context.common_fields();
            fields.push(("outcome", Value::String("connect_failed".to_string())));
            fields.push(("error", Value::String(error.to_string())));
            emit_egress_proxy_log(
                request_context.clock.as_ref(),
                &request_context.sandbox_instance_id,
                "egress_proxy_request_failed",
                &fields,
            );
            return Err(EgressProxyError::new(format!(
                "direct gateway HTTP egress failed: {error}"
            )));
        }
    };

    response_from_direct_gateway_response(gateway_response, request_context)
}

async fn send_direct_gateway_http_request(
    request: Request<HyperBody>,
    direct_uri: &Uri,
) -> Result<Response<Incoming>, EgressProxyError> {
    let (mut parts, body) = request.into_parts();
    parts.uri = origin_form_uri(direct_uri)?;
    parts
        .headers
        .insert(HOST, direct_gateway_host_header(direct_uri)?);

    match connect_direct_http_upstream(direct_uri, true).await? {
        DirectHttpUpstreamStream::Plain(stream) => {
            send_direct_upstream_http_request_over_io(stream, Request::from_parts(parts, body))
                .await
        }
        DirectHttpUpstreamStream::Tls(stream) => {
            send_direct_upstream_http_request_over_io(*stream, Request::from_parts(parts, body))
                .await
        }
    }
}

async fn tunnel_direct_gateway_upgrade(
    downstream_upgrade: hyper::upgrade::OnUpgrade,
    gateway_socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<(), EgressProxyError> {
    tunnel_websocket_upgrade(downstream_upgrade, gateway_socket).await
}

async fn tunnel_websocket_upgrade(
    downstream_upgrade: hyper::upgrade::OnUpgrade,
    upstream_socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<(), EgressProxyError> {
    let downstream = downstream_upgrade.await.map_err(|error| {
        EgressProxyError::new(format!("failed to upgrade downstream websocket: {error}"))
    })?;
    let downstream =
        WebSocketStream::from_raw_socket(TokioIo::new(downstream), Role::Server, None).await;
    let (mut downstream_writer, mut downstream_reader) = downstream.split();
    let (mut upstream_writer, mut upstream_reader) = upstream_socket.split();

    let mut request_task = tokio::spawn(async move {
        while let Some(message) = downstream_reader.next().await {
            let message = message.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to read downstream websocket message: {error}"
                ))
            })?;
            if matches!(message, Message::Close(_)) {
                upstream_writer.send(message).await.map_err(|error| {
                    EgressProxyError::new(format!(
                        "failed to close upstream websocket request stream: {error}"
                    ))
                })?;
                return Ok::<(), EgressProxyError>(());
            }
            upstream_writer.send(message).await.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to write upstream websocket request message: {error}"
                ))
            })?;
        }
        upstream_writer.close().await.map_err(|error| {
            EgressProxyError::new(format!(
                "failed to close upstream websocket request stream: {error}"
            ))
        })
    });

    let mut response_task = tokio::spawn(async move {
        while let Some(message) = upstream_reader.next().await {
            let message = message.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to read upstream websocket response message: {error}"
                ))
            })?;
            let close_received = matches!(message, Message::Close(_));
            downstream_writer.send(message).await.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to write downstream websocket response message: {error}"
                ))
            })?;
            if close_received {
                return Ok::<(), EgressProxyError>(());
            }
        }
        downstream_writer.close().await.map_err(|error| {
            EgressProxyError::new(format!("failed to close downstream websocket: {error}"))
        })
    });

    tokio::select! {
        request_result = &mut request_task => {
            request_result
                .map_err(|error| EgressProxyError::new(format!("direct gateway websocket request task failed: {error}")))??;
            response_task.await
                .map_err(|error| EgressProxyError::new(format!("direct gateway websocket response task failed: {error}")))?
        }
        response_result = &mut response_task => {
            request_task.abort();
            response_result
                .map_err(|error| EgressProxyError::new(format!("direct gateway websocket response task failed: {error}")))?
        }
    }
}

async fn send_direct_upstream_http_request(
    parts: hyper::http::request::Parts,
    body: Incoming,
    request_target: &RequestTarget,
    mark_upstream_socket: bool,
) -> Result<Response<Incoming>, EgressProxyError> {
    let mut request_builder = Request::builder()
        .method(parts.method)
        .uri(origin_form_uri(&request_target.uri)?)
        .header(HOST, request_target.authority.as_str());
    for (header_name, header_value) in filter_outbound_request_headers(&parts.headers) {
        request_builder = request_builder.header(header_name, header_value);
    }
    let direct_request = request_builder
        .body(box_body(body.map_err(box_hyper_error)))
        .map_err(|error| {
            EgressProxyError::new(format!("failed to build direct upstream request: {error}"))
        })?;

    match connect_direct_http_upstream(&request_target.uri, mark_upstream_socket).await? {
        DirectHttpUpstreamStream::Plain(stream) => {
            send_direct_upstream_http_request_over_io(stream, direct_request).await
        }
        DirectHttpUpstreamStream::Tls(stream) => {
            send_direct_upstream_http_request_over_io(*stream, direct_request).await
        }
    }
}

async fn send_direct_upstream_http_request_over_io<T>(
    stream: T,
    request: Request<HyperBody>,
) -> Result<Response<Incoming>, EgressProxyError>
where
    T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = client_http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|error| {
            EgressProxyError::new(format!("direct upstream HTTP handshake failed: {error}"))
        })?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    sender.send_request(request).await.map_err(|error| {
        EgressProxyError::new(format!("direct upstream HTTP request failed: {error}"))
    })
}

async fn connect_direct_http_upstream(
    uri: &Uri,
    mark_upstream_socket: bool,
) -> Result<DirectHttpUpstreamStream, EgressProxyError> {
    let target_url = Url::parse(&uri.to_string()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse direct upstream HTTP target '{uri}': {error}"
        ))
    })?;
    let host = target_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct upstream HTTP target '{target_url}' is missing a host"
        ))
    })?;
    let port = target_url.port_or_known_default().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct upstream HTTP target '{target_url}' is missing a port for scheme '{}'",
            target_url.scheme()
        ))
    })?;
    let tcp_stream = connect_upstream_tcp_stream(host, port, mark_upstream_socket).await?;

    match target_url.scheme() {
        "http" => Ok(DirectHttpUpstreamStream::Plain(tcp_stream)),
        "https" => {
            let server_name = ServerName::try_from(host.to_string()).map_err(|error| {
                EgressProxyError::new(format!(
                    "direct upstream HTTPS target host '{host}' is not a valid TLS server name: {error}"
                ))
            })?;
            let tls_stream = build_direct_tls_connector()?
                .connect(server_name, tcp_stream)
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "direct upstream HTTPS handshake to '{host}:{port}' failed: {error}"
                    ))
                })?;
            Ok(DirectHttpUpstreamStream::Tls(Box::new(tls_stream)))
        }
        scheme => Err(EgressProxyError::new(format!(
            "direct upstream HTTP target must use http or https, got '{scheme}'"
        ))),
    }
}

async fn connect_direct_upstream_websocket(
    uri: &Uri,
    mark_upstream_socket: bool,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, EgressProxyError> {
    let target = websocket_target_url(uri)?;
    let target_url = Url::parse(&target).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse direct upstream websocket target '{target}': {error}"
        ))
    })?;
    let host = target_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct upstream websocket target '{target_url}' is missing a host"
        ))
    })?;
    let port = target_url.port_or_known_default().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct upstream websocket target '{target_url}' is missing a port for scheme '{}'",
            target_url.scheme()
        ))
    })?;
    let tcp_stream = connect_upstream_tcp_stream(host, port, mark_upstream_socket).await?;
    let upstream_stream = match target_url.scheme() {
        "ws" => MaybeTlsStream::Plain(tcp_stream),
        "wss" => {
            let server_name = ServerName::try_from(host.to_string()).map_err(|error| {
                EgressProxyError::new(format!(
                    "direct upstream websocket target host '{host}' is not a valid TLS server name: {error}"
                ))
            })?;
            let tls_stream = build_direct_tls_connector()?
                .connect(server_name, tcp_stream)
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "direct upstream websocket TLS handshake to '{host}:{port}' failed: {error}"
                    ))
                })?;
            MaybeTlsStream::Rustls(tls_stream)
        }
        scheme => {
            return Err(EgressProxyError::new(format!(
                "direct upstream websocket target must use ws or wss, got '{scheme}'"
            )));
        }
    };
    let request = target.into_client_request().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build direct upstream websocket request: {error}"
        ))
    })?;
    client_async(request, upstream_stream)
        .await
        .map(|(socket, _)| socket)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "direct upstream websocket connection failed: {error}"
            ))
        })
}

async fn connect_upstream_tcp_stream(
    host: &str,
    port: u16,
    mark_upstream_socket: bool,
) -> Result<TcpStream, EgressProxyError> {
    let mut last_error: Option<String> = None;
    let socket_addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to resolve direct upstream '{host}:{port}': {error}"
            ))
        })?;

    for socket_address in socket_addresses {
        let socket = match socket_address {
            SocketAddr::V4(_) => TcpSocket::new_v4(),
            SocketAddr::V6(_) => TcpSocket::new_v6(),
        }
        .map_err(|error| {
            EgressProxyError::new(format!("failed to create direct upstream socket: {error}"))
        })?;
        if mark_upstream_socket {
            configure_transparent_passthrough_upstream_socket(&socket)?;
        }
        match socket.connect(socket_address).await {
            Ok(stream) => return Ok(stream),
            Err(error) => {
                last_error = Some(format!("{socket_address}: {error}"));
            }
        }
    }

    Err(EgressProxyError::new(format!(
        "failed to connect direct upstream '{host}:{port}'{}",
        last_error.map_or_else(String::new, |error| format!(": {error}"))
    )))
}

fn build_direct_tls_connector() -> Result<TlsConnector, EgressProxyError> {
    let config = ClientConfig::builder()
        .with_native_roots()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to load native roots for direct upstream TLS: {error}"
            ))
        })?
        .with_no_client_auth();
    Ok(TlsConnector::from(Arc::new(config)))
}

fn origin_form_uri(uri: &Uri) -> Result<Uri, EgressProxyError> {
    uri.path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str())
        .parse()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct upstream origin-form URI: {error}"
            ))
        })
}

fn direct_gateway_host_header(uri: &Uri) -> Result<HeaderValue, EgressProxyError> {
    let authority = uri.authority().ok_or_else(|| {
        EgressProxyError::new(format!(
            "direct gateway egress URL '{uri}' is missing an authority"
        ))
    })?;
    HeaderValue::from_str(authority.as_str()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build direct gateway host header for '{authority}': {error}"
        ))
    })
}

fn response_from_direct_upstream_response(
    upstream_response: Response<Incoming>,
    request_context: Arc<EgressProxyRequestContext>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let status = upstream_response.status();
    let mut response_headers_fields = request_context.common_fields();
    response_headers_fields.push(("upstreamStatus", Value::from(u64::from(status.as_u16()))));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upstream_headers_received",
        &response_headers_fields,
    );

    let (parts, body) = upstream_response.into_parts();
    let mut response_builder = Response::builder().status(parts.status);
    for (header_name, header_value) in filter_outbound_response_headers(&parts.headers) {
        response_builder = response_builder.header(header_name, header_value);
    }
    response_builder = response_builder.header(
        SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        request_context.request_id.as_str(),
    );

    response_builder
        .body(box_body(InstrumentedResponseBody {
            inner: box_body(body.map_err(box_hyper_error)),
            context: request_context,
            upstream_status: status,
            upstream_trace_id: None,
            chunk_count: 0,
            forwarded_bytes: 0,
            first_chunk_at_ms: None,
            ended: false,
        }))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct upstream egress response: {error}"
            ))
        })
}

fn response_from_direct_gateway_response(
    gateway_response: Response<Incoming>,
    request_context: Arc<EgressProxyRequestContext>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let status = gateway_response.status();
    let mut response_headers_fields = request_context.common_fields();
    response_headers_fields.push(("upstreamStatus", Value::from(u64::from(status.as_u16()))));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upstream_headers_received",
        &response_headers_fields,
    );

    let (parts, body) = gateway_response.into_parts();
    let mut response_builder = Response::builder().status(parts.status);
    for (header_name, header_value) in filter_outbound_response_headers(&parts.headers) {
        response_builder = response_builder.header(header_name, header_value);
    }
    response_builder = response_builder.header(
        SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        request_context.request_id.as_str(),
    );

    response_builder
        .body(box_body(InstrumentedResponseBody {
            inner: box_body(body.map_err(box_hyper_error)),
            context: request_context,
            upstream_status: status,
            upstream_trace_id: None,
            chunk_count: 0,
            forwarded_bytes: 0,
            first_chunk_at_ms: None,
            ended: false,
        }))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct gateway egress response: {error}"
            ))
        })
}

async fn accept_transparent_tls_stream(
    stream: tokio::net::TcpStream,
    fallback_authority: &str,
    state: EgressProxyState,
) -> Result<tokio_rustls::server::TlsStream<tokio::net::TcpStream>, EgressProxyError> {
    let lazy_acceptor = LazyConfigAcceptor::new(RustlsServerAcceptor::default(), stream);
    let start_handshake = lazy_acceptor.await.map_err(|error| {
        EgressProxyError::new(format!(
            "failed to read transparent TLS client hello: {error}"
        ))
    })?;
    let certificate_name = start_handshake
        .client_hello()
        .server_name()
        .map_or_else(|| fallback_authority.to_string(), ToString::to_string);
    let server_config = build_tls_server_config(
        &certificate_name,
        state.proxy_ca_certificate_pem.as_str(),
        state.proxy_ca_private_key_pem.as_str(),
        state.clock.as_ref(),
    )?;
    start_handshake
        .into_stream(Arc::new(server_config))
        .await
        .map_err(|error| EgressProxyError::new(format!("transparent TLS MITM failed: {error}")))
}

fn build_tls_server_config(
    authority: &str,
    proxy_ca_certificate_pem: &str,
    proxy_ca_private_key_pem: &str,
    clock: &dyn Clock,
) -> Result<ServerConfig, EgressProxyError> {
    let issued_certificate = issue_proxy_leaf_certificate(
        proxy_ca_certificate_pem.to_string(),
        proxy_ca_private_key_pem.to_string(),
        authority.to_string(),
        clock,
    )
    .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let certificate_chain = load_certificate_chain(&issued_certificate.certificate_chain_pem)?;
    let private_key = load_private_key(&issued_certificate.private_key_pem)?;
    ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certificate_chain, private_key)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build local egress proxy certificate chain: {error}"
            ))
        })
}

fn websocket_target_url(target_url: &Uri) -> Result<String, EgressProxyError> {
    let mut parsed_target = Url::parse(&target_url.to_string()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse websocket egress target '{target_url}': {error}"
        ))
    })?;
    match parsed_target.scheme() {
        "http" => parsed_target.set_scheme("ws").map_err(|_| {
            EgressProxyError::new("failed to set websocket egress target scheme to ws")
        })?,
        "https" => parsed_target.set_scheme("wss").map_err(|_| {
            EgressProxyError::new("failed to set websocket egress target scheme to wss")
        })?,
        "ws" | "wss" => {}
        scheme => {
            return Err(EgressProxyError::new(format!(
                "websocket egress target must use http, https, ws, or wss scheme, got '{scheme}'"
            )));
        }
    }
    Ok(parsed_target.to_string())
}

fn box_hyper_error(error: hyper::Error) -> BoxError {
    Box::new(error)
}

fn filter_outbound_request_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "connection"
                    | "proxy-connection"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "keep-alive"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
                    | "upgrade"
                    | "host"
            );
            if blocked {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

fn filter_direct_gateway_request_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    filter_outbound_request_headers(headers)
        .into_iter()
        .filter(|(name, _)| {
            !name
                .as_str()
                .eq_ignore_ascii_case(DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME)
        })
        .collect()
}

fn filter_outbound_response_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "connection"
                    | "proxy-connection"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "keep-alive"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
                    | "upgrade"
            );
            if blocked {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

fn build_tls_acceptor(
    authority: &str,
    proxy_ca_certificate_pem: &str,
    proxy_ca_private_key_pem: &str,
    clock: &dyn Clock,
) -> Result<TlsAcceptor, EgressProxyError> {
    Ok(TlsAcceptor::from(Arc::new(build_tls_server_config(
        authority,
        proxy_ca_certificate_pem,
        proxy_ca_private_key_pem,
        clock,
    )?)))
}

fn load_certificate_chain(
    certificate_chain_pem: &str,
) -> Result<Vec<CertificateDer<'static>>, EgressProxyError> {
    <(rustls_pki_types::pem::SectionKind, Vec<u8>)>::pem_slice_iter(
        certificate_chain_pem.as_bytes(),
    )
    .filter_map(|section| match section {
        Ok((rustls_pki_types::pem::SectionKind::Certificate, der)) => {
            Some(Ok(CertificateDer::from(der)))
        }
        Ok(_) => None,
        Err(error) => Some(Err(EgressProxyError::new(format!(
            "failed to parse local egress proxy certificate chain: {error}"
        )))),
    })
    .collect()
}

fn load_private_key(private_key_pem: &str) -> Result<PrivateKeyDer<'static>, EgressProxyError> {
    PrivateKeyDer::from_pem_slice(private_key_pem.as_bytes()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse local egress proxy private key: {error}"
        ))
    })
}

fn infallible_to_box_error(error: Infallible) -> BoxError {
    match error {}
}

fn box_body<B>(body: B) -> HyperBody
where
    B: Body<Data = Bytes> + Send + Sync + 'static,
    B::Error: Into<BoxError>,
{
    body.map_err(Into::into).boxed()
}

fn empty_body() -> HyperBody {
    box_body(Full::new(Bytes::new()).map_err(infallible_to_box_error))
}

fn emit_egress_proxy_log(
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

fn serialize_egress_proxy_log_line(
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

fn text_response(status: StatusCode, message: impl Into<String>) -> Response<HyperBody> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(box_body(
            Full::new(Bytes::from(message.into())).map_err(infallible_to_box_error),
        ))
        .expect("text response should build")
}

#[cfg(test)]
mod tests;

mod ca;
mod routing;
mod transparent;
