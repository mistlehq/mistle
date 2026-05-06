//! Sandbox-local egress proxy for runtime tools and interactive shells.
//!
//! Runtime tools like `gh` and `git` expect standard `HTTP[S]_PROXY` semantics,
//! while tokenizer-proxy expects route-relative requests plus an egress grant.
//! This module bridges those models: it exposes one local forward proxy inside
//! the sandbox, terminates proxied HTTPS sessions with an ephemeral CA, matches
//! each decrypted request against the compiled runtime-plan egress routes, and
//! then forwards the request to tokenizer-proxy with the matching grant header.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::fmt::{self, Display};
use std::fs::{self, DirBuilder};
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::os::unix::fs::DirBuilderExt;
#[cfg(target_os = "linux")]
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Command;
use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full};
use hyper::body::{Body, Frame, Incoming, SizeHint};
use hyper::header::{HOST, HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioIo};
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use serde_json::{Map, Value};
use tokio::io::copy_bidirectional;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::runtime::Builder;
use tokio::sync::{mpsc as tokio_mpsc, oneshot};
use tokio_rustls::rustls::{ServerConfig, server::Acceptor as RustlsServerAcceptor};
use tokio_rustls::{LazyConfigAcceptor, TlsAcceptor};

use crate::protocol::startup::StartupInput;
use crate::proxy_ca::{generate_proxy_ca, issue_proxy_leaf_certificate};
use crate::runtime::{CompiledEgressRoute, CompiledRuntimePlan};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};
use crate::tunnel::session::{
    GatewayEgressForwarder, TunnelEgressHttpRequest, TunnelEgressHttpResponse, TunnelSessionError,
};

const TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME: &str = "X-Mistle-Egress-Grant";
const RUNTIME_PROXY_CA_CERT_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca.pem";
const RUNTIME_PROXY_CA_BUNDLE_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem";
const RUNTIME_PROXY_CA_TRUST_STORE_PATH: &str =
    "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt";
const SYSTEM_CA_CERT_BUNDLE_PATH: &str = "/etc/ssl/certs/ca-certificates.crt";
const UPDATE_CA_CERTIFICATES_COMMAND: &str = "update-ca-certificates";
const DEFAULT_LOOPBACK_PROXY_PORT: u16 = 38_513;
#[cfg(target_os = "linux")]
const DEFAULT_TRANSPARENT_PROXY_PORT: u16 = 38_514;
const EGRESS_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(250);
const EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);
const EGRESS_PROXY_RESTART_BACKOFF_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 5000];
const RUNTIME_NO_PROXY_DEFAULTS: [&str; 2] = ["127.0.0.1", "localhost"];
const SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME: &str = "x-mistle-sandbox-egress-id";

const MANAGED_PROXY_ENV_KEYS: [&str; 16] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
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
type EgressConnector = HttpsConnector<HttpConnector>;

#[derive(Clone, Copy)]
struct ProxyCaConfig<'a> {
    runtime_certificate_path: &'a Path,
    runtime_certificate_bundle_path: &'a Path,
    trust_store_certificate_path: &'a Path,
    system_certificate_bundle_path: &'a Path,
    refresh_command: &'a Path,
}

#[derive(Clone, Copy)]
struct EgressProxyLogContext<'a> {
    clock: &'a dyn Clock,
    sandbox_instance_id: &'a str,
}

#[derive(Debug)]
pub struct EgressProxy {
    runtime_env: BTreeMap<String, String>,
    routes: Arc<RwLock<Vec<EgressProxyRoute>>>,
    shutdown_requested: Arc<AtomicBool>,
    supervisor_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
    transparent_server: Option<ActiveEgressProxyServer>,
    #[cfg(any(test, debug_assertions))]
    supervisor_command_sender: Option<mpsc::Sender<EgressProxySupervisorCommand>>,
    proxy_ca_installation: ProxyCaInstallation,
    supervisor_handle: SandboxdSupervisorHandle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressProxyError {
    message: String,
}

#[derive(Debug, Clone)]
struct EgressProxyRoute {
    egress_rule_id: String,
    upstream_base_url: String,
    host: String,
    path_prefixes: Vec<String>,
    methods: Option<Vec<String>>,
    grant: Option<String>,
}

#[derive(Clone)]
enum EgressProxyForwardingMode {
    TokenizerProxy {
        tokenizer_proxy_egress_base_url: String,
    },
    Gateway {
        forwarder: GatewayEgressForwarder,
    },
}

#[derive(Clone)]
struct EgressProxyState {
    sandbox_instance_id: String,
    forwarding_mode: EgressProxyForwardingMode,
    routes: Arc<RwLock<Vec<EgressProxyRoute>>>,
    client: Client<EgressConnector, Incoming>,
    proxy_ca_certificate_pem: Arc<String>,
    proxy_ca_private_key_pem: Arc<String>,
    clock: Arc<dyn Clock>,
    next_request_id: Arc<AtomicU64>,
}

#[derive(Debug)]
struct ProxyCaInstallation {
    runtime_certificate_path: PathBuf,
    runtime_certificate_bundle_path: PathBuf,
    trust_store_certificate_path: PathBuf,
    refresh_command: PathBuf,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct RequestTarget {
    authority: String,
    host: String,
    uri: Uri,
}

#[derive(Clone)]
struct RequestTargetOverride {
    scheme: &'static str,
    default_authority: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TransparentProxyProtocol {
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

struct GatewayEgressResponseBody {
    inner: Mutex<tokio_mpsc::UnboundedReceiver<Result<Bytes, TunnelSessionError>>>,
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

impl ProxyCaInstallation {
    fn install(
        proxy_ca_certificate_pem: &str,
        runtime_certificate_path: &Path,
        runtime_certificate_bundle_path: &Path,
        trust_store_certificate_path: &Path,
        system_certificate_bundle_path: &Path,
        refresh_command: &Path,
        log_context: EgressProxyLogContext<'_>,
    ) -> Result<Self, EgressProxyError> {
        emit_proxy_ca_lifecycle_log(
            log_context,
            "egress_proxy_ca_install_started",
            runtime_certificate_path,
            trust_store_certificate_path,
            refresh_command,
            None,
        );
        let runtime_directory = runtime_certificate_path.parent().ok_or_else(|| {
            EgressProxyError::new("egress proxy CA path must include a parent directory")
        })?;
        prepare_proxy_directory(runtime_directory)?;
        let runtime_bundle_directory =
            runtime_certificate_bundle_path.parent().ok_or_else(|| {
                EgressProxyError::new("egress proxy CA bundle path must include a parent directory")
            })?;
        prepare_proxy_directory(runtime_bundle_directory)?;

        let trust_store_directory = trust_store_certificate_path.parent().ok_or_else(|| {
            EgressProxyError::new("egress proxy trust store path must include a parent directory")
        })?;
        prepare_system_trust_store_directory(trust_store_directory)?;
        let system_certificate_bundle =
            fs::read(system_certificate_bundle_path).map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to read system certificate bundle '{}': {error}",
                    system_certificate_bundle_path.display()
                ))
            })?;

        fs::write(
            runtime_certificate_path,
            proxy_ca_certificate_pem.as_bytes(),
        )
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to write local egress proxy certificate '{}': {error}",
                runtime_certificate_path.display()
            ))
        })?;
        let runtime_certificate_bundle =
            build_combined_certificate_bundle(&system_certificate_bundle, proxy_ca_certificate_pem);
        fs::write(runtime_certificate_bundle_path, &runtime_certificate_bundle).map_err(
            |error| {
                EgressProxyError::new(format!(
                    "failed to write local egress proxy certificate bundle '{}': {error}",
                    runtime_certificate_bundle_path.display()
                ))
            },
        )?;
        fs::write(
            trust_store_certificate_path,
            proxy_ca_certificate_pem.as_bytes(),
        )
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to write local egress proxy trust store certificate '{}': {error}",
                trust_store_certificate_path.display()
            ))
        })?;

        let installation = Self {
            runtime_certificate_path: runtime_certificate_path.to_path_buf(),
            runtime_certificate_bundle_path: runtime_certificate_bundle_path.to_path_buf(),
            trust_store_certificate_path: trust_store_certificate_path.to_path_buf(),
            refresh_command: refresh_command.to_path_buf(),
        };

        if let Err(error) = installation.refresh_system_trust_store() {
            let cleanup_error = installation.cleanup().err().map(|cleanup_error| {
                format!(" cleanup after trust store refresh failure also failed: {cleanup_error}")
            });
            let suffix = cleanup_error.unwrap_or_default();
            return Err(EgressProxyError::new(format!("{error}{suffix}")));
        }

        emit_proxy_ca_lifecycle_log(
            log_context,
            "egress_proxy_ca_install_completed",
            runtime_certificate_path,
            trust_store_certificate_path,
            refresh_command,
            None,
        );

        Ok(installation)
    }

    fn cleanup(&self) -> Result<(), EgressProxyError> {
        match fs::remove_file(&self.trust_store_certificate_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to remove local egress proxy trust store certificate '{}': {error}",
                    self.trust_store_certificate_path.display()
                )));
            }
        }

        self.refresh_system_trust_store()?;

        match fs::remove_file(&self.runtime_certificate_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to remove local egress proxy certificate '{}': {error}",
                    self.runtime_certificate_path.display()
                )));
            }
        }
        match fs::remove_file(&self.runtime_certificate_bundle_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to remove local egress proxy certificate bundle '{}': {error}",
                    self.runtime_certificate_bundle_path.display()
                )));
            }
        }

        Ok(())
    }

    fn refresh_system_trust_store(&self) -> Result<(), EgressProxyError> {
        run_update_ca_certificates(&self.refresh_command)
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

impl Body for GatewayEgressResponseBody {
    type Data = Bytes;
    type Error = BoxError;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        let mut receiver = self
            .inner
            .lock()
            .expect("gateway egress response body lock should not be poisoned");
        match receiver.poll_recv(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Ok(bytes))) => Poll::Ready(Some(Ok(Frame::data(bytes)))),
            Poll::Ready(Some(Err(error))) => Poll::Ready(Some(Err(Box::new(error)))),
            Poll::Ready(None) => Poll::Ready(None),
        }
    }
}

impl EgressProxy {
    pub fn start(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        tokenizer_proxy_egress_base_url: &str,
        gateway_egress_forwarder: Option<GatewayEgressForwarder>,
        clock: Arc<dyn Clock>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Option<Self>, EgressProxyError> {
        let forwarding_mode = match gateway_egress_forwarder {
            Some(forwarder) => EgressProxyForwardingMode::Gateway { forwarder },
            None => EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url: tokenizer_proxy_egress_base_url.to_string(),
            },
        };
        Self::start_with_options(
            runtime_plan,
            startup_input,
            forwarding_mode,
            default_loopback_proxy_listener_address(),
            ProxyCaConfig {
                runtime_certificate_path: Path::new(RUNTIME_PROXY_CA_CERT_PATH),
                runtime_certificate_bundle_path: Path::new(RUNTIME_PROXY_CA_BUNDLE_PATH),
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
        if runtime_plan.egress_routes.is_empty() {
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
            .map(|route| match &forwarding_mode {
                EgressProxyForwardingMode::TokenizerProxy { .. } => {
                    build_proxy_route(route, startup_input)
                }
                EgressProxyForwardingMode::Gateway { .. } => build_gateway_proxy_route(route),
            })
            .collect::<Result<Vec<_>, _>>()?;

        let generated_proxy_ca = generate_proxy_ca(clock.as_ref())
            .map_err(|error| EgressProxyError::new(error.to_string()))?;
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

        let mut http_connector = HttpConnector::new();
        http_connector.enforce_http(false);
        let https_connector = match HttpsConnectorBuilder::new().with_native_roots() {
            Ok(https_connector_builder) => https_connector_builder,
            Err(error) => {
                let cleanup_suffix = cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                    .err()
                    .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                    .unwrap_or_default();
                return Err(EgressProxyError::new(format!(
                    "failed to load system certificate roots for local egress proxy: {error}{cleanup_suffix}"
                )));
            }
        }
            .https_or_http()
            .enable_http1()
            .wrap_connector(http_connector);
        let routes = Arc::new(RwLock::new(routes));
        let state = EgressProxyState {
            sandbox_instance_id: supervisor_handle.sandbox_instance_id().to_string(),
            forwarding_mode: forwarding_mode.clone(),
            routes: routes.clone(),
            client: Client::builder(TokioExecutor::new()).build(https_connector),
            proxy_ca_certificate_pem: Arc::new(generated_proxy_ca.certificate_pem.clone()),
            proxy_ca_private_key_pem: Arc::new(generated_proxy_ca.private_key_pem),
            clock,
            next_request_id: Arc::new(AtomicU64::new(1)),
        };
        let transparent_listener_address =
            transparent_proxy_listener_address_for_forwarding_mode(&forwarding_mode)?;

        let runtime_env = match build_managed_proxy_env(
            listener_address,
            proxy_ca_config.runtime_certificate_bundle_path,
            match &forwarding_mode {
                EgressProxyForwardingMode::TokenizerProxy {
                    tokenizer_proxy_egress_base_url,
                } => Some(tokenizer_proxy_egress_base_url.as_str()),
                EgressProxyForwardingMode::Gateway { .. } => None,
            },
        ) {
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

        let transparent_server = match transparent_listener_address {
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
            routes,
            shutdown_requested,
            supervisor_thread: Some(supervisor_thread),
            transparent_server,
            #[cfg(any(test, debug_assertions))]
            supervisor_command_sender: Some(supervisor_command_sender),
            proxy_ca_installation,
            supervisor_handle,
        }))
    }

    pub fn runtime_env(&self) -> &BTreeMap<String, String> {
        &self.runtime_env
    }

    pub fn refresh_grants(
        &self,
        runtime_plan: &CompiledRuntimePlan,
        egress_grant_by_rule_id: &BTreeMap<String, String>,
    ) -> Result<(), EgressProxyError> {
        let log_context = EgressProxyLogContext {
            clock: &SystemClock,
            sandbox_instance_id: self.supervisor_handle.sandbox_instance_id(),
        };
        let route_count = runtime_plan.egress_routes.len();
        emit_egress_proxy_log(
            log_context.clock,
            log_context.sandbox_instance_id,
            "egress_proxy_grant_refresh_started",
            &[("routeCount", Value::from(route_count))],
        );

        let refreshed_routes = runtime_plan
            .egress_routes
            .iter()
            .map(|route| build_proxy_route_with_grants(route, egress_grant_by_rule_id))
            .collect::<Result<Vec<_>, _>>();

        let refreshed_routes = match refreshed_routes {
            Ok(refreshed_routes) => refreshed_routes,
            Err(error) => {
                emit_egress_proxy_log(
                    log_context.clock,
                    log_context.sandbox_instance_id,
                    "egress_proxy_grant_refresh_failed",
                    &[
                        ("routeCount", Value::from(route_count)),
                        ("error", Value::String(error.to_string())),
                    ],
                );
                return Err(error);
            }
        };

        let refresh_result = {
            let mut routes = self
                .routes
                .write()
                .map_err(|_| EgressProxyError::new("egress proxy route table lock is poisoned"))?;
            validate_refresh_routes_are_compatible(&routes, &refreshed_routes)?;
            *routes = refreshed_routes;
            Ok::<(), EgressProxyError>(())
        };

        match refresh_result {
            Ok(()) => {
                emit_egress_proxy_log(
                    log_context.clock,
                    log_context.sandbox_instance_id,
                    "egress_proxy_grant_refresh_completed",
                    &[("routeCount", Value::from(route_count))],
                );
                Ok(())
            }
            Err(error) => {
                emit_egress_proxy_log(
                    log_context.clock,
                    log_context.sandbox_instance_id,
                    "egress_proxy_grant_refresh_failed",
                    &[
                        ("routeCount", Value::from(route_count)),
                        ("error", Value::String(error.to_string())),
                    ],
                );
                Err(error)
            }
        }
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

#[cfg(target_os = "linux")]
fn recover_original_destination(
    stream: &tokio::net::TcpStream,
) -> Result<SocketAddr, EgressProxyError> {
    let socket_fd = stream.as_raw_fd();
    let (socket_level, socket_option) = match stream.local_addr() {
        Ok(SocketAddr::V4(_)) => (nix::libc::SOL_IP, nix::libc::SO_ORIGINAL_DST),
        Ok(SocketAddr::V6(_)) => (nix::libc::IPPROTO_IPV6, nix::libc::IP6T_SO_ORIGINAL_DST),
        Err(error) => {
            return Err(EgressProxyError::new(format!(
                "failed to inspect transparent egress local address: {error}"
            )));
        }
    };
    let mut sockaddr = std::mem::MaybeUninit::<nix::libc::sockaddr_storage>::zeroed();
    let mut sockaddr_length: nix::libc::socklen_t =
        std::mem::size_of::<nix::libc::sockaddr_storage>()
            .try_into()
            .map_err(|_| EgressProxyError::new("sockaddr storage length does not fit socklen_t"))?;
    let result = unsafe {
        nix::libc::getsockopt(
            socket_fd,
            socket_level,
            socket_option,
            sockaddr.as_mut_ptr().cast(),
            &mut sockaddr_length,
        )
    };
    if result != 0 {
        return Err(EgressProxyError::new(format!(
            "failed to recover transparent egress original destination: {}",
            std::io::Error::last_os_error()
        )));
    }

    let sockaddr = unsafe { sockaddr.assume_init() };
    socket_addr_from_sockaddr_storage(sockaddr, sockaddr_length)
}

#[cfg(not(target_os = "linux"))]
fn recover_original_destination(
    _stream: &tokio::net::TcpStream,
) -> Result<SocketAddr, EgressProxyError> {
    Err(EgressProxyError::new(
        "transparent egress original destination lookup requires Linux SO_ORIGINAL_DST",
    ))
}

#[cfg(target_os = "linux")]
fn socket_addr_from_sockaddr_storage(
    sockaddr: nix::libc::sockaddr_storage,
    sockaddr_length: nix::libc::socklen_t,
) -> Result<SocketAddr, EgressProxyError> {
    match sockaddr.ss_family.into() {
        nix::libc::AF_INET => {
            let expected_length = std::mem::size_of::<nix::libc::sockaddr_in>();
            if usize::try_from(sockaddr_length)
                .ok()
                .is_none_or(|length| length < expected_length)
            {
                return Err(EgressProxyError::new(
                    "SO_ORIGINAL_DST returned a truncated IPv4 socket address",
                ));
            }
            let sockaddr_in = unsafe {
                std::ptr::addr_of!(sockaddr)
                    .cast::<nix::libc::sockaddr_in>()
                    .read_unaligned()
            };
            let address = std::net::Ipv4Addr::from(u32::from_be(sockaddr_in.sin_addr.s_addr));
            let port = u16::from_be(sockaddr_in.sin_port);
            Ok(SocketAddr::from((address, port)))
        }
        nix::libc::AF_INET6 => {
            let expected_length = std::mem::size_of::<nix::libc::sockaddr_in6>();
            if usize::try_from(sockaddr_length)
                .ok()
                .is_none_or(|length| length < expected_length)
            {
                return Err(EgressProxyError::new(
                    "SO_ORIGINAL_DST returned a truncated IPv6 socket address",
                ));
            }
            let sockaddr_in6 = unsafe {
                std::ptr::addr_of!(sockaddr)
                    .cast::<nix::libc::sockaddr_in6>()
                    .read_unaligned()
            };
            let address = std::net::Ipv6Addr::from(sockaddr_in6.sin6_addr.s6_addr);
            let port = u16::from_be(sockaddr_in6.sin6_port);
            Ok(SocketAddr::from((address, port)))
        }
        family => Err(EgressProxyError::new(format!(
            "SO_ORIGINAL_DST returned unsupported socket family {family}"
        ))),
    }
}

fn build_proxy_route(
    route: &CompiledEgressRoute,
    startup_input: &StartupInput,
) -> Result<EgressProxyRoute, EgressProxyError> {
    build_proxy_route_with_grants(route, &startup_input.egress_grant_by_rule_id)
}

fn build_proxy_route_with_grants(
    route: &CompiledEgressRoute,
    egress_grant_by_rule_id: &BTreeMap<String, String>,
) -> Result<EgressProxyRoute, EgressProxyError> {
    let upstream_url = url::Url::parse(&route.upstream.base_url).map_err(|error| {
        EgressProxyError::new(format!(
            "runtime plan egress route '{}' has invalid upstream base url '{}': {error}",
            route.egress_rule_id, route.upstream.base_url
        ))
    })?;
    let host = upstream_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "runtime plan egress route '{}' upstream '{}' must include a host",
            route.egress_rule_id, route.upstream.base_url
        ))
    })?;
    let grant = egress_grant_by_rule_id
        .get(&route.egress_rule_id)
        .ok_or_else(|| {
            EgressProxyError::new(format!(
                "missing egress grant for route '{}'",
                route.egress_rule_id
            ))
        })?
        .clone();

    Ok(EgressProxyRoute {
        egress_rule_id: route.egress_rule_id.clone(),
        upstream_base_url: route.upstream.base_url.clone(),
        host: host.to_string(),
        path_prefixes: route
            .r#match
            .path_prefixes
            .clone()
            .unwrap_or_else(|| vec!["/".to_string()]),
        methods: route.r#match.methods.clone().map(|methods| {
            methods
                .into_iter()
                .map(|method| method.to_ascii_uppercase())
                .collect()
        }),
        grant: Some(grant),
    })
}

fn build_gateway_proxy_route(
    route: &CompiledEgressRoute,
) -> Result<EgressProxyRoute, EgressProxyError> {
    let upstream_url = url::Url::parse(&route.upstream.base_url).map_err(|error| {
        EgressProxyError::new(format!(
            "runtime plan egress route '{}' has invalid upstream base url '{}': {error}",
            route.egress_rule_id, route.upstream.base_url
        ))
    })?;
    let host = upstream_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "runtime plan egress route '{}' upstream '{}' must include a host",
            route.egress_rule_id, route.upstream.base_url
        ))
    })?;

    Ok(EgressProxyRoute {
        egress_rule_id: route.egress_rule_id.clone(),
        upstream_base_url: route.upstream.base_url.clone(),
        host: host.to_string(),
        path_prefixes: route
            .r#match
            .path_prefixes
            .clone()
            .unwrap_or_else(|| vec!["/".to_string()]),
        methods: route.r#match.methods.clone().map(|methods| {
            methods
                .into_iter()
                .map(|method| method.to_ascii_uppercase())
                .collect()
        }),
        grant: None,
    })
}

fn prepare_proxy_directory(path: &Path) -> Result<(), EgressProxyError> {
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to create local egress proxy directory '{}': {error}",
                path.display()
            ))
        })
}

fn prepare_system_trust_store_directory(path: &Path) -> Result<(), EgressProxyError> {
    fs::create_dir_all(path).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to create system trust store directory '{}': {error}",
            path.display()
        ))
    })
}

fn build_combined_certificate_bundle(
    system_certificate_bundle: &[u8],
    proxy_ca_certificate_pem: &str,
) -> Vec<u8> {
    let mut combined_bundle =
        Vec::with_capacity(system_certificate_bundle.len() + proxy_ca_certificate_pem.len() + 1);
    combined_bundle.extend_from_slice(system_certificate_bundle);
    if !combined_bundle.ends_with(b"\n") {
        combined_bundle.push(b'\n');
    }
    combined_bundle.extend_from_slice(proxy_ca_certificate_pem.as_bytes());
    combined_bundle
}

fn run_update_ca_certificates(command_path: &Path) -> Result<(), EgressProxyError> {
    let output = Command::new(command_path).output().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to run '{}' to refresh the system trust store: {error}",
            command_path.display()
        ))
    })?;
    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut output_parts = Vec::new();
    if !stdout.is_empty() {
        output_parts.push(format!("stdout={stdout}"));
    }
    if !stderr.is_empty() {
        output_parts.push(format!("stderr={stderr}"));
    }
    let output_suffix = if output_parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", output_parts.join(" "))
    };

    Err(EgressProxyError::new(format!(
        "'{}' failed while refreshing the system trust store with status {}{}",
        command_path.display(),
        output
            .status
            .code()
            .map_or_else(|| "signal".to_string(), |code| code.to_string()),
        output_suffix
    )))
}

fn build_managed_proxy_env(
    listener_address: SocketAddr,
    ca_certificate_path: &Path,
    tokenizer_proxy_egress_base_url: Option<&str>,
) -> Result<BTreeMap<String, String>, EgressProxyError> {
    let proxy_url = format!("http://{listener_address}");
    let certificate_path = ca_certificate_path.display().to_string();
    let no_proxy_value = build_no_proxy_value(tokenizer_proxy_egress_base_url)?;

    Ok(BTreeMap::from([
        ("HTTP_PROXY".to_string(), proxy_url.clone()),
        ("HTTPS_PROXY".to_string(), proxy_url.clone()),
        ("ALL_PROXY".to_string(), proxy_url.clone()),
        ("NO_PROXY".to_string(), no_proxy_value.clone()),
        ("http_proxy".to_string(), proxy_url.clone()),
        ("https_proxy".to_string(), proxy_url.clone()),
        ("all_proxy".to_string(), proxy_url),
        ("no_proxy".to_string(), no_proxy_value),
        ("SSL_CERT_FILE".to_string(), certificate_path.clone()),
        ("CURL_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("GIT_SSL_CAINFO".to_string(), certificate_path.clone()),
        ("REQUESTS_CA_BUNDLE".to_string(), certificate_path.clone()),
        ("NODE_EXTRA_CA_CERTS".to_string(), certificate_path.clone()),
        ("NIX_SSL_CERT_FILE".to_string(), certificate_path),
    ]))
}

fn build_no_proxy_value(
    tokenizer_proxy_egress_base_url: Option<&str>,
) -> Result<String, EgressProxyError> {
    let mut no_proxy_hosts = RUNTIME_NO_PROXY_DEFAULTS
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    let Some(tokenizer_proxy_egress_base_url) = tokenizer_proxy_egress_base_url else {
        return Ok(no_proxy_hosts.join(","));
    };

    let tokenizer_proxy_url = url::Url::parse(tokenizer_proxy_egress_base_url).map_err(|error| {
            EgressProxyError::new(format!(
                "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' is invalid: {error}"
            ))
        })?;
    let tokenizer_proxy_host = tokenizer_proxy_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' must include a host"
        ))
    })?;

    no_proxy_hosts.push(tokenizer_proxy_host.to_string());
    if let Some(port) = tokenizer_proxy_url.port() {
        no_proxy_hosts.push(format!("{tokenizer_proxy_host}:{port}"));
    }

    Ok(no_proxy_hosts.join(","))
}

fn transparent_proxy_listener_address_for_forwarding_mode(
    forwarding_mode: &EgressProxyForwardingMode,
) -> Result<Option<SocketAddr>, EgressProxyError> {
    match forwarding_mode {
        EgressProxyForwardingMode::TokenizerProxy { .. } => Ok(None),
        EgressProxyForwardingMode::Gateway { .. } => {
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
    stream: tokio::net::TcpStream,
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
            emit_egress_proxy_log(
                state.clock.as_ref(),
                &state.sandbox_instance_id,
                "egress_proxy_transparent_connection_unsupported",
                &fields,
            );
            Ok(())
        }
    }
}

async fn classify_transparent_proxy_stream(
    stream: &tokio::net::TcpStream,
) -> Result<TransparentProxyProtocol, EgressProxyError> {
    let mut first_byte = [0_u8; 1];
    let byte_count = stream.peek(&mut first_byte).await.map_err(|error| {
        EgressProxyError::new(format!(
            "failed to inspect transparent egress proxy connection: {error}"
        ))
    })?;
    if byte_count == 0 {
        return Ok(TransparentProxyProtocol::Unsupported);
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
        TransparentProxyProtocol::PlainHttp => "http",
        TransparentProxyProtocol::Tls => "tls",
        TransparentProxyProtocol::Unsupported => "unsupported",
    }
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
    let (parts, body) = request.into_parts();
    let request_method = parts.method.clone();
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
    if let EgressProxyForwardingMode::Gateway { forwarder } = &state.forwarding_mode {
        let forwarder = forwarder.clone();
        return forward_upgrade_request_through_gateway(
            parts,
            state,
            request_target,
            request_path_and_query,
            route,
            forwarder,
            downstream_upgrade,
        )
        .await;
    }
    let EgressProxyForwardingMode::TokenizerProxy {
        tokenizer_proxy_egress_base_url,
    } = &state.forwarding_mode
    else {
        return Err(EgressProxyError::new(
            "egress proxy forwarding mode changed while handling websocket upgrade",
        ));
    };
    let upstream_uri = match route {
        Some(_) => build_tokenizer_proxy_forward_uri(
            tokenizer_proxy_egress_base_url,
            &request_path_and_query,
        )?,
        None => request_target.uri.clone(),
    };
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
        route_mode: if route.is_some() { "managed" } else { "direct" },
        egress_rule_id: route
            .as_ref()
            .map(|matched_route| matched_route.egress_rule_id.clone()),
        upstream_url: upstream_uri.to_string(),
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

    let mut outbound_request = Request::builder().method(request_method).uri(upstream_uri);
    for (header_name, header_value) in filter_upgrade_request_headers(&parts.headers) {
        outbound_request = outbound_request.header(header_name, header_value);
    }
    let outbound_request = match &route {
        Some(route) => {
            let grant = route.grant.as_deref().ok_or_else(|| {
                EgressProxyError::new(format!(
                    "route '{}' is missing an egress grant for tokenizer-proxy forwarding",
                    route.egress_rule_id
                ))
            })?;
            outbound_request
                .header(TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME, grant)
                .body(body)
                .map_err(|error| {
                    EgressProxyError::new(format!(
                        "failed to build proxied upgrade request: {error}"
                    ))
                })?
        }
        None => outbound_request.body(body).map_err(|error| {
            EgressProxyError::new(format!("failed to build direct upgrade request: {error}"))
        })?,
    };

    let mut upstream_response =
        state
            .client
            .request(outbound_request)
            .await
            .map_err(|error| match &route {
                Some(route) => EgressProxyError::new(format!(
                    "failed to forward upgrade request for '{}' through tokenizer-proxy route '{}': {error}",
                    route.host, route.upstream_base_url
                )),
                None => EgressProxyError::new(format!(
                    "failed to forward upgrade request directly to '{}': {error}",
                    request_target.authority
                )),
            })?;

    let upstream_status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();
    if upstream_status != StatusCode::SWITCHING_PROTOCOLS {
        let (parts, body) = upstream_response.into_parts();
        let mut response_builder = Response::builder().status(parts.status);
        for (header_name, header_value) in filter_outbound_response_headers(&parts.headers) {
            response_builder = response_builder.header(header_name, header_value);
        }
        response_builder = response_builder.header(
            SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
            request_context.request_id.as_str(),
        );
        return response_builder
            .body(box_body(InstrumentedResponseBody {
                inner: box_body(body),
                context: request_context,
                upstream_status,
                upstream_trace_id: header_value_to_string(
                    upstream_headers.get("x-mistle-trace-id"),
                ),
                chunk_count: 0,
                forwarded_bytes: 0,
                first_chunk_at_ms: None,
                ended: false,
            }))
            .map_err(|error| {
                EgressProxyError::new(format!("failed to build upgrade error response: {error}"))
            });
    }

    let upstream_upgrade = hyper::upgrade::on(&mut upstream_response);
    let mut response_builder = Response::builder().status(upstream_status);
    for (header_name, header_value) in filter_upgrade_response_headers(&upstream_headers) {
        response_builder = response_builder.header(header_name, header_value);
    }
    response_builder = response_builder.header(
        SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        request_context.request_id.as_str(),
    );

    let tunnel_context = request_context.clone();
    tokio::spawn(async move {
        let tunnel_result = async {
            let downstream = downstream_upgrade.await.map_err(|error| {
                EgressProxyError::new(format!("failed to upgrade downstream websocket: {error}"))
            })?;
            let upstream = upstream_upgrade.await.map_err(|error| {
                EgressProxyError::new(format!("failed to upgrade upstream websocket: {error}"))
            })?;
            let mut downstream = TokioIo::new(downstream);
            let mut upstream = TokioIo::new(upstream);
            copy_bidirectional(&mut downstream, &mut upstream)
                .await
                .map_err(|error| {
                    EgressProxyError::new(format!("websocket tunnel copy failed: {error}"))
                })?;
            Ok::<(), EgressProxyError>(())
        }
        .await;

        if let Err(error) = tunnel_result {
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
    });

    response_builder.body(empty_body()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build websocket upgrade response: {error}"
        ))
    })
}

async fn forward_upgrade_request_through_gateway(
    parts: hyper::http::request::Parts,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    route: Option<EgressProxyRoute>,
    forwarder: GatewayEgressForwarder,
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
        route_mode: "gateway",
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

    let path = parts.uri.path().to_string();
    let query = parts.uri.query().map(ToString::to_string);
    let scheme = match request_target.uri.scheme_str().unwrap_or("http") {
        "ws" => "http",
        "wss" => "https",
        scheme => scheme,
    }
    .to_string();
    let headers =
        repeated_headers_from_filtered_headers(filter_upgrade_request_headers(&parts.headers))?;
    let tunnel_request = TunnelEgressHttpRequest {
        request_id: request_context.request_id.clone(),
        method: request_method.to_string(),
        scheme,
        authority: request_target.authority,
        path,
        query,
        headers,
    };

    let exchange = forwarder
        .open_http(tunnel_request)
        .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let (request_body_sender, response_receiver) = exchange.into_parts();
    request_body_sender
        .send_end()
        .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let gateway_response =
        tokio::task::spawn_blocking(move || response_receiver.recv_response_start())
            .await
            .map_err(|error| {
                EgressProxyError::new(format!("gateway egress forwarding task failed: {error}"))
            })?
            .map_err(|error| EgressProxyError::new(error.to_string()))?;

    let status = StatusCode::from_u16(gateway_response.status).map_err(|error| {
        EgressProxyError::new(format!(
            "gateway egress returned invalid websocket status '{}': {error}",
            gateway_response.status
        ))
    })?;
    if status != StatusCode::SWITCHING_PROTOCOLS {
        return response_from_gateway_egress_response(gateway_response, request_context);
    }

    let mut response_builder = Response::builder().status(status);
    for (header_name, header_value) in
        filtered_upgrade_response_headers_from_repeated_headers(&gateway_response.headers)?
    {
        response_builder = response_builder.header(header_name, header_value);
    }
    response_builder = response_builder.header(
        SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        request_context.request_id.as_str(),
    );

    let tunnel_context = request_context.clone();
    tokio::spawn(async move {
        let tunnel_result = tunnel_gateway_upgrade(
            downstream_upgrade,
            request_body_sender,
            gateway_response.body,
        )
        .await;

        if let Err(error) = tunnel_result {
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
    });

    response_builder.body(empty_body()).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build gateway websocket upgrade response: {error}"
        ))
    })
}

async fn forward_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    target_override: Option<RequestTargetOverride>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let (parts, body) = request.into_parts();
    let request_method = parts.method.clone();
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
    if let EgressProxyForwardingMode::Gateway { forwarder } = &state.forwarding_mode {
        let forwarder = forwarder.clone();
        return forward_request_through_gateway(
            parts,
            body,
            state,
            request_target,
            request_path_and_query,
            route,
            forwarder,
        )
        .await;
    }
    let EgressProxyForwardingMode::TokenizerProxy {
        tokenizer_proxy_egress_base_url,
    } = &state.forwarding_mode
    else {
        return Err(EgressProxyError::new(
            "egress proxy forwarding mode changed while handling request",
        ));
    };
    let upstream_uri = match route {
        Some(_) => build_tokenizer_proxy_forward_uri(
            tokenizer_proxy_egress_base_url,
            &request_path_and_query,
        )?,
        None => request_target.uri.clone(),
    };
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
        route_mode: if route.is_some() { "managed" } else { "direct" },
        egress_rule_id: route
            .as_ref()
            .map(|matched_route| matched_route.egress_rule_id.clone()),
        upstream_url: upstream_uri.to_string(),
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

    let mut outbound_request = Request::builder().method(request_method).uri(upstream_uri);
    for (header_name, header_value) in filter_outbound_request_headers(&parts.headers) {
        outbound_request = outbound_request.header(header_name, header_value);
    }
    let outbound_request = match &route {
        Some(route) => {
            let grant = route.grant.as_deref().ok_or_else(|| {
                EgressProxyError::new(format!(
                    "route '{}' is missing an egress grant for tokenizer-proxy forwarding",
                    route.egress_rule_id
                ))
            })?;
            outbound_request
                .header(TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME, grant)
                .body(body)
                .map_err(|error| {
                    EgressProxyError::new(format!("failed to build proxied request: {error}"))
                })?
        }
        None => outbound_request.body(body).map_err(|error| {
            EgressProxyError::new(format!("failed to build direct proxied request: {error}"))
        })?,
    };

    let upstream_response = match state.client.request(outbound_request).await {
        Ok(upstream_response) => upstream_response,
        Err(error) => {
            let error_text = error.to_string();
            let mut request_failed_fields = request_context.common_fields();
            request_failed_fields.push(("outcome", Value::String("request_failed".to_string())));
            request_failed_fields.push(("error", Value::String(error_text.clone())));
            emit_egress_proxy_log(
                request_context.clock.as_ref(),
                &request_context.sandbox_instance_id,
                "egress_proxy_request_failed",
                &request_failed_fields,
            );
            return Err(match &route {
                Some(route) => EgressProxyError::new(format!(
                    "failed to forward request for '{}' through tokenizer-proxy route '{}': {error_text}",
                    route.host, route.upstream_base_url
                )),
                None => EgressProxyError::new(format!(
                    "failed to forward proxied request directly to '{}': {error_text}",
                    request_target.authority
                )),
            });
        }
    };

    let upstream_status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();
    let upstream_trace_id = header_value_to_string(upstream_headers.get("x-mistle-trace-id"));
    let mut response_headers_fields = request_context.common_fields();
    response_headers_fields.push((
        "upstreamStatus",
        Value::from(u64::from(upstream_status.as_u16())),
    ));
    if let Some(content_type) = header_value_to_string(upstream_headers.get("content-type")) {
        response_headers_fields.push(("contentType", Value::String(content_type)));
    }
    if let Some(content_length) = header_value_to_string(upstream_headers.get("content-length")) {
        response_headers_fields.push(("contentLength", Value::String(content_length)));
    }
    if let Some(transfer_encoding) =
        header_value_to_string(upstream_headers.get("transfer-encoding"))
    {
        response_headers_fields.push(("transferEncoding", Value::String(transfer_encoding)));
    }
    if let Some(upstream_trace_id) = &upstream_trace_id {
        response_headers_fields.push(("upstreamTraceId", Value::String(upstream_trace_id.clone())));
    }
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
            inner: box_body(body),
            context: request_context,
            upstream_status,
            upstream_trace_id,
            chunk_count: 0,
            forwarded_bytes: 0,
            first_chunk_at_ms: None,
            ended: false,
        }))
        .map_err(|error| {
            EgressProxyError::new(format!("failed to build proxied response: {error}"))
        })
}

async fn forward_request_through_gateway(
    parts: hyper::http::request::Parts,
    body: Incoming,
    state: EgressProxyState,
    request_target: RequestTarget,
    request_path_and_query: String,
    route: Option<EgressProxyRoute>,
    forwarder: GatewayEgressForwarder,
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
        route_mode: "gateway",
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

    let path = parts.uri.path().to_string();
    let query = parts.uri.query().map(ToString::to_string);
    let scheme = request_target
        .uri
        .scheme_str()
        .ok_or_else(|| EgressProxyError::new("gateway egress request target is missing scheme"))?
        .to_string();
    let headers =
        repeated_headers_from_filtered_headers(filter_outbound_request_headers(&parts.headers))?;
    let tunnel_request = TunnelEgressHttpRequest {
        request_id: request_context.request_id.clone(),
        method: request_method.to_string(),
        scheme,
        authority: request_target.authority,
        path,
        query,
        headers,
    };

    let exchange = forwarder
        .open_http(tunnel_request)
        .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let (request_body_sender, response_receiver) = exchange.into_parts();
    let mut request_body_task = tokio::spawn(stream_gateway_egress_request_body(
        body,
        request_body_sender,
    ));
    let mut response_start_task =
        tokio::task::spawn_blocking(move || response_receiver.recv_response_start());
    let gateway_response = tokio::select! {
        request_body_result = &mut request_body_task => {
            request_body_result
                .map_err(|error| EgressProxyError::new(format!("gateway egress request body task failed: {error}")))??;
            response_start_task.await
                .map_err(|error| EgressProxyError::new(format!("gateway egress forwarding task failed: {error}")))?
                .map_err(|error| EgressProxyError::new(error.to_string()))?
        }
        response_start_result = &mut response_start_task => {
            match response_start_result
                .map_err(|error| EgressProxyError::new(format!("gateway egress forwarding task failed: {error}")))?
            {
                Ok(response) => response,
                Err(error) => {
                    request_body_task.abort();
                    return Err(EgressProxyError::new(error.to_string()));
                }
            }
        }
    };

    response_from_gateway_egress_response(gateway_response, request_context)
}

async fn stream_gateway_egress_request_body(
    mut body: Incoming,
    request_body_sender: crate::tunnel::session::GatewayEgressHttpRequestBodySender,
) -> Result<(), EgressProxyError> {
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|error| {
            EgressProxyError::new(format!(
                "failed to read proxied request body for gateway egress: {error}"
            ))
        })?;
        if let Ok(bytes) = frame.into_data()
            && !bytes.is_empty()
        {
            request_body_sender
                .send_chunk(bytes)
                .map_err(|error| EgressProxyError::new(error.to_string()))?;
        }
    }
    request_body_sender
        .send_end()
        .map_err(|error| EgressProxyError::new(error.to_string()))
}

async fn tunnel_gateway_upgrade(
    downstream_upgrade: hyper::upgrade::OnUpgrade,
    request_body_sender: crate::tunnel::session::GatewayEgressHttpRequestBodySender,
    mut gateway_response_body: tokio_mpsc::UnboundedReceiver<Result<Bytes, TunnelSessionError>>,
) -> Result<(), EgressProxyError> {
    let downstream = downstream_upgrade.await.map_err(|error| {
        EgressProxyError::new(format!("failed to upgrade downstream websocket: {error}"))
    })?;
    let downstream = TokioIo::new(downstream);
    let (mut downstream_reader, mut downstream_writer) = tokio::io::split(downstream);

    let mut request_task = tokio::spawn(async move {
        let mut buffer = vec![0_u8; 16 * 1024];
        loop {
            let byte_count = downstream_reader.read(&mut buffer).await.map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to read downstream websocket bytes: {error}"
                ))
            })?;
            if byte_count == 0 {
                request_body_sender
                    .close_upgraded_request()
                    .map_err(|error| EgressProxyError::new(error.to_string()))?;
                return Ok::<(), EgressProxyError>(());
            }
            request_body_sender
                .send_upgraded_bytes(Bytes::copy_from_slice(&buffer[..byte_count]))
                .map_err(|error| EgressProxyError::new(error.to_string()))?;
        }
    });

    let mut response_task = tokio::spawn(async move {
        while let Some(frame) = gateway_response_body.recv().await {
            let bytes = frame.map_err(|error| EgressProxyError::new(error.to_string()))?;
            if !bytes.is_empty() {
                downstream_writer.write_all(&bytes).await.map_err(|error| {
                    EgressProxyError::new(format!(
                        "failed to write gateway websocket bytes downstream: {error}"
                    ))
                })?;
            }
        }
        downstream_writer.shutdown().await.map_err(|error| {
            EgressProxyError::new(format!("failed to close downstream websocket: {error}"))
        })
    });

    tokio::select! {
        request_result = &mut request_task => {
            request_result
                .map_err(|error| EgressProxyError::new(format!("gateway websocket request task failed: {error}")))??;
            response_task.await
                .map_err(|error| EgressProxyError::new(format!("gateway websocket response task failed: {error}")))?
        }
        response_result = &mut response_task => {
            request_task.abort();
            response_result
                .map_err(|error| EgressProxyError::new(format!("gateway websocket response task failed: {error}")))?
        }
    }
}

fn response_from_gateway_egress_response(
    gateway_response: TunnelEgressHttpResponse,
    request_context: Arc<EgressProxyRequestContext>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let status = StatusCode::from_u16(gateway_response.status).map_err(|error| {
        EgressProxyError::new(format!(
            "gateway egress returned invalid http status '{}': {error}",
            gateway_response.status
        ))
    })?;
    let mut response_headers_fields = request_context.common_fields();
    response_headers_fields.push(("upstreamStatus", Value::from(u64::from(status.as_u16()))));
    emit_egress_proxy_log(
        request_context.clock.as_ref(),
        &request_context.sandbox_instance_id,
        "egress_proxy_upstream_headers_received",
        &response_headers_fields,
    );

    let mut response_builder = Response::builder().status(status);
    for (header_name, header_value) in
        filtered_response_headers_from_repeated_headers(&gateway_response.headers)?
    {
        response_builder = response_builder.header(header_name, header_value);
    }
    response_builder = response_builder.header(
        SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        request_context.request_id.as_str(),
    );

    response_builder
        .body(box_body(InstrumentedResponseBody {
            inner: box_body(GatewayEgressResponseBody {
                inner: Mutex::new(gateway_response.body),
            }),
            context: request_context,
            upstream_status: status,
            upstream_trace_id: None,
            chunk_count: 0,
            forwarded_bytes: 0,
            first_chunk_at_ms: None,
            ended: false,
        }))
        .map_err(|error| {
            EgressProxyError::new(format!("failed to build gateway egress response: {error}"))
        })
}

fn resolve_request_target(
    request: &hyper::http::request::Parts,
    target_override: Option<&RequestTargetOverride>,
) -> Result<RequestTarget, EgressProxyError> {
    let authority = if let Some(authority) = request.uri.authority() {
        authority.as_str().to_string()
    } else if let Some(host) = request.headers.get(HOST) {
        host.to_str()
            .map(|value| value.to_string())
            .map_err(|error| {
                EgressProxyError::new(format!("proxied request host header is invalid: {error}"))
            })?
    } else if let Some(target_override) = target_override {
        target_override.default_authority.clone()
    } else {
        return Err(EgressProxyError::new("proxied request is missing a host"));
    };
    let scheme = target_override.map_or_else(
        || request.uri.scheme_str().unwrap_or("http"),
        |target_override| target_override.scheme,
    );
    let uri = match (
        request.uri.scheme(),
        request.uri.authority(),
        target_override,
    ) {
        (Some(_), Some(_), None) => request.uri.clone(),
        (Some(_), Some(_), Some(_)) => request.uri.clone(),
        _ => build_direct_forward_uri(scheme, &authority, request.uri.path_and_query())?,
    };

    Ok(RequestTarget {
        host: normalize_authority_host(&authority),
        authority,
        uri,
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

fn build_direct_forward_uri(
    scheme: &str,
    authority: &str,
    path_and_query: Option<&hyper::http::uri::PathAndQuery>,
) -> Result<Uri, EgressProxyError> {
    let path_and_query = path_and_query.map_or("/", |path_and_query| path_and_query.as_str());

    format!("{scheme}://{authority}{path_and_query}")
        .parse()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build direct forward uri for '{scheme}://{authority}{path_and_query}': {error}"
            ))
        })
}

fn normalize_authority_host(authority: &str) -> String {
    authority
        .trim()
        .strip_prefix('[')
        .and_then(|authority| authority.split_once(']'))
        .map_or_else(
            || {
                authority
                    .split_once(':')
                    .map_or_else(|| authority.to_string(), |(host, _)| host.to_string())
            },
            |(host, _)| host.to_string(),
        )
}

fn match_state_route(
    state: &EgressProxyState,
    host: &str,
    path: &str,
    method: &str,
) -> Result<Option<EgressProxyRoute>, EgressProxyError> {
    let routes = state
        .routes
        .read()
        .map_err(|_| EgressProxyError::new("egress proxy route table lock is poisoned"))?;
    match_route(&routes, host, path, method).map(|route| route.cloned())
}

fn match_route<'a>(
    routes: &'a [EgressProxyRoute],
    host: &str,
    path: &str,
    method: &str,
) -> Result<Option<&'a EgressProxyRoute>, EgressProxyError> {
    let matching_routes = routes
        .iter()
        .filter(|route| {
            route.host == host
                && route
                    .path_prefixes
                    .iter()
                    .any(|path_prefix| path.starts_with(path_prefix))
                && route
                    .methods
                    .as_ref()
                    .is_none_or(|methods| methods.iter().any(|route_method| route_method == method))
        })
        .collect::<Vec<_>>();

    match matching_routes.as_slice() {
        [] => Ok(None),
        [route] => Ok(Some(*route)),
        _ => Err(EgressProxyError::new(format!(
            "multiple sandbox egress routes matched proxied request {method} {host}{path}"
        ))),
    }
}

fn validate_refresh_routes_are_compatible(
    current_routes: &[EgressProxyRoute],
    refreshed_routes: &[EgressProxyRoute],
) -> Result<(), EgressProxyError> {
    if current_routes.len() != refreshed_routes.len() {
        return Err(EgressProxyError::new(format!(
            "egress proxy grant refresh expected {} routes but received {} routes",
            current_routes.len(),
            refreshed_routes.len()
        )));
    }

    for (current_route, refreshed_route) in current_routes.iter().zip(refreshed_routes) {
        if current_route.egress_rule_id != refreshed_route.egress_rule_id
            || current_route.upstream_base_url != refreshed_route.upstream_base_url
            || current_route.host != refreshed_route.host
            || current_route.path_prefixes != refreshed_route.path_prefixes
            || current_route.methods != refreshed_route.methods
        {
            return Err(EgressProxyError::new(format!(
                "egress proxy grant refresh cannot change route '{}' definition",
                current_route.egress_rule_id
            )));
        }
    }

    Ok(())
}

fn build_tokenizer_proxy_forward_uri(
    tokenizer_proxy_egress_base_url: &str,
    path_and_query: &str,
) -> Result<Uri, EgressProxyError> {
    let mut tokenizer_proxy_url = url::Url::parse(tokenizer_proxy_egress_base_url).map_err(|error| {
        EgressProxyError::new(format!(
            "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' is invalid: {error}"
        ))
    })?;
    let path_and_query_url = url::Url::parse(&format!("http://proxy.internal{path_and_query}"))
        .map_err(|error| {
            EgressProxyError::new(format!(
                "proxied request target '{path_and_query}' is invalid: {error}"
            ))
        })?;
    tokenizer_proxy_url.set_path(&join_url_path(
        tokenizer_proxy_url.path(),
        path_and_query_url.path(),
    ));
    tokenizer_proxy_url.set_query(path_and_query_url.query());
    tokenizer_proxy_url.set_fragment(None);

    tokenizer_proxy_url.to_string().parse().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to build tokenizer-proxy forward uri: {error}"
        ))
    })
}

fn join_url_path(base_path: &str, suffix_path: &str) -> String {
    let normalized_base_path = base_path.strip_suffix('/').unwrap_or(base_path);
    let normalized_suffix_path = suffix_path.strip_prefix('/').unwrap_or(suffix_path);

    if normalized_base_path.is_empty() || normalized_base_path == "/" {
        if normalized_suffix_path.is_empty() {
            return "/".to_string();
        }

        return format!("/{normalized_suffix_path}");
    }

    if normalized_suffix_path.is_empty() {
        return normalized_base_path.to_string();
    }

    format!("{normalized_base_path}/{normalized_suffix_path}")
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

fn filter_upgrade_request_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "host"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "proxy-connection"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
            );
            if blocked {
                return None;
            }
            Some((name.clone(), value.clone()))
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

fn repeated_headers_from_filtered_headers(
    headers: Vec<(HeaderName, HeaderValue)>,
) -> Result<BTreeMap<String, Vec<String>>, EgressProxyError> {
    let mut repeated_headers = BTreeMap::<String, Vec<String>>::new();
    for (name, value) in headers {
        let value = value.to_str().map_err(|error| {
            EgressProxyError::new(format!(
                "gateway egress request header '{}' is not valid utf-8: {error}",
                name.as_str()
            ))
        })?;
        repeated_headers
            .entry(name.as_str().to_string())
            .or_default()
            .push(value.to_string());
    }
    Ok(repeated_headers)
}

fn filtered_response_headers_from_repeated_headers(
    headers: &BTreeMap<String, Vec<String>>,
) -> Result<Vec<(HeaderName, HeaderValue)>, EgressProxyError> {
    let mut header_map = hyper::HeaderMap::new();
    for (name, values) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            EgressProxyError::new(format!(
                "gateway egress response header name '{name}' is invalid: {error}"
            ))
        })?;
        for value in values {
            let header_value = HeaderValue::from_str(value).map_err(|error| {
                EgressProxyError::new(format!(
                    "gateway egress response header '{name}' has invalid value: {error}"
                ))
            })?;
            header_map.append(header_name.clone(), header_value);
        }
    }
    Ok(filter_outbound_response_headers(&header_map))
}

fn filtered_upgrade_response_headers_from_repeated_headers(
    headers: &BTreeMap<String, Vec<String>>,
) -> Result<Vec<(HeaderName, HeaderValue)>, EgressProxyError> {
    let mut header_map = hyper::HeaderMap::new();
    for (name, values) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            EgressProxyError::new(format!(
                "gateway egress upgrade response header name '{name}' is invalid: {error}"
            ))
        })?;
        for value in values {
            let header_value = HeaderValue::from_str(value).map_err(|error| {
                EgressProxyError::new(format!(
                    "gateway egress upgrade response header '{name}' has invalid value: {error}"
                ))
            })?;
            header_map.append(header_name.clone(), header_value);
        }
    }
    Ok(filter_upgrade_response_headers(&header_map))
}

fn filter_upgrade_response_headers(
    headers: &hyper::HeaderMap<HeaderValue>,
) -> Vec<(HeaderName, HeaderValue)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let blocked = matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "proxy-authenticate"
                    | "proxy-authorization"
                    | "proxy-connection"
                    | "te"
                    | "trailer"
                    | "transfer-encoding"
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

fn header_value_to_string(header_value: Option<&HeaderValue>) -> Option<String> {
    header_value.and_then(|header_value| header_value.to_str().ok().map(ToString::to_string))
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

fn emit_proxy_ca_lifecycle_log(
    log_context: EgressProxyLogContext<'_>,
    event: &str,
    runtime_certificate_path: &Path,
    trust_store_certificate_path: &Path,
    refresh_command: &Path,
    error: Option<String>,
) {
    let mut fields = vec![
        (
            "runtimeCertificatePath",
            Value::String(runtime_certificate_path.display().to_string()),
        ),
        (
            "trustStoreCertificatePath",
            Value::String(trust_store_certificate_path.display().to_string()),
        ),
        (
            "refreshCommand",
            Value::String(refresh_command.display().to_string()),
        ),
    ];
    if let Some(error) = error {
        fields.push(("error", Value::String(error)));
    }
    emit_egress_proxy_log(
        log_context.clock,
        log_context.sandbox_instance_id,
        event,
        &fields,
    );
}

fn cleanup_proxy_ca_installation(
    installation: &ProxyCaInstallation,
    log_context: EgressProxyLogContext<'_>,
) -> Result<(), EgressProxyError> {
    emit_proxy_ca_lifecycle_log(
        log_context,
        "egress_proxy_ca_cleanup_started",
        &installation.runtime_certificate_path,
        &installation.trust_store_certificate_path,
        &installation.refresh_command,
        None,
    );
    match installation.cleanup() {
        Ok(()) => {
            emit_proxy_ca_lifecycle_log(
                log_context,
                "egress_proxy_ca_cleanup_completed",
                &installation.runtime_certificate_path,
                &installation.trust_store_certificate_path,
                &installation.refresh_command,
                None,
            );
            Ok(())
        }
        Err(error) => {
            emit_proxy_ca_lifecycle_log(
                log_context,
                "egress_proxy_ca_cleanup_failed",
                &installation.runtime_certificate_path,
                &installation.trust_store_certificate_path,
                &installation.refresh_command,
                Some(error.to_string()),
            );
            Err(error)
        }
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
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener as StdTcpListener};
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[cfg(target_os = "linux")]
    use crate::egress_proxy::socket_addr_from_sockaddr_storage;
    use crate::egress_proxy::{
        EgressProxy, EgressProxyForwardingMode, EgressProxyRoute, ProxyCaConfig,
        RequestTargetOverride, SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME, TransparentProxyProtocol,
        build_direct_forward_uri, build_managed_proxy_env, classify_transparent_proxy_first_byte,
        join_url_path, match_route, resolve_request_target, serialize_egress_proxy_log_line,
    };
    use crate::protocol::startup::{StartupInput, StartupMode};
    use crate::runtime::{
        CompiledEgressRoute, CompiledEgressRouteAuthInjection,
        CompiledEgressRouteAuthInjectionType, CompiledEgressRouteCredentialResolver,
        CompiledEgressRouteMatch, CompiledEgressRouteUpstream, CompiledRuntimePlan,
    };
    use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
    use crate::time::SystemClock;
    use crate::time::testing::MutableClock;
    use reqwest::Proxy;
    use rustls_pki_types::pem::PemObject;
    use rustls_pki_types::{CertificateDer, ServerName};
    use serde_json::Value;
    use tokio_rustls::rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};

    struct TestProxyCaPaths {
        root_directory: PathBuf,
        system_certificate_bundle_path: PathBuf,
        runtime_certificate_path: PathBuf,
        runtime_certificate_bundle_path: PathBuf,
        trust_store_certificate_path: PathBuf,
        refresh_command_path: PathBuf,
        refresh_marker_path: PathBuf,
    }

    static TEST_PROXY_CA_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn joins_proxy_forward_paths_without_duplicate_slashes() {
        assert_eq!(
            join_url_path("/tokenizer-proxy/egress", "/graphql"),
            "/tokenizer-proxy/egress/graphql"
        );
        assert_eq!(
            join_url_path("/tokenizer-proxy/egress/", "/mistlehq/repo.git"),
            "/tokenizer-proxy/egress/mistlehq/repo.git"
        );
    }

    #[test]
    fn matches_route_by_host_path_and_method() {
        let routes = vec![
            EgressProxyRoute {
                egress_rule_id: "egress-rule-a".to_string(),
                upstream_base_url: "https://api.github.com".to_string(),
                host: "api.github.com".to_string(),
                path_prefixes: vec!["/graphql".to_string()],
                methods: Some(vec!["POST".to_string()]),
                grant: Some("grant-a".to_string()),
            },
            EgressProxyRoute {
                egress_rule_id: "egress-rule-b".to_string(),
                upstream_base_url: "https://github.com".to_string(),
                host: "github.com".to_string(),
                path_prefixes: vec!["/mistlehq/mistle.git".to_string()],
                methods: Some(vec!["GET".to_string()]),
                grant: Some("grant-b".to_string()),
            },
        ];

        let graphql_route = match_route(&routes, "api.github.com", "/graphql", "POST")
            .expect("graphql route should match");
        assert_eq!(
            graphql_route
                .expect("graphql route should resolve exactly one match")
                .grant
                .as_deref(),
            Some("grant-a")
        );

        let git_route = match_route(
            &routes,
            "github.com",
            "/mistlehq/mistle.git/info/refs",
            "GET",
        )
        .expect("git route should match");
        assert_eq!(
            git_route
                .expect("git route should resolve exactly one match")
                .grant
                .as_deref(),
            Some("grant-b")
        );
    }

    #[test]
    fn leaves_unmatched_requests_for_direct_passthrough() {
        let routes = vec![EgressProxyRoute {
            egress_rule_id: "egress-rule-a".to_string(),
            upstream_base_url: "https://api.openai.com".to_string(),
            host: "api.openai.com".to_string(),
            path_prefixes: vec!["/v1/responses".to_string()],
            methods: Some(vec!["POST".to_string()]),
            grant: Some("grant-a".to_string()),
        }];

        let route = match_route(
            &routes,
            "deb.debian.org",
            "/debian/dists/bookworm/InRelease",
            "GET",
        )
        .expect("unmatched route evaluation should succeed");

        assert!(route.is_none());
    }

    #[test]
    fn builds_https_direct_forward_uris_for_tunneled_requests() {
        let direct_uri = build_direct_forward_uri(
            "https",
            "tokenizer-proxy-dev_thomas.mistle.dev",
            Some(
                &"/tokenizer-proxy/egress/v1/responses?stream=true"
                    .parse()
                    .expect("path and query should parse"),
            ),
        )
        .expect("direct https forward uri should build");

        assert_eq!(
            direct_uri.to_string(),
            "https://tokenizer-proxy-dev_thomas.mistle.dev/tokenizer-proxy/egress/v1/responses?stream=true"
        );
    }

    #[test]
    fn resolves_transparent_plaintext_http_targets_from_host_header() {
        let request = hyper::Request::builder()
            .method("GET")
            .uri("/v1/models?limit=1")
            .header("host", "api.openai.com")
            .body(())
            .expect("transparent request should build");
        let (parts, ()) = request.into_parts();

        let target = resolve_request_target(
            &parts,
            Some(&RequestTargetOverride {
                scheme: "http",
                default_authority: "203.0.113.10:80".to_string(),
            }),
        )
        .expect("transparent HTTP target should resolve");

        assert_eq!(target.authority, "api.openai.com");
        assert_eq!(target.host, "api.openai.com");
        assert_eq!(
            target.uri.to_string(),
            "http://api.openai.com/v1/models?limit=1"
        );
    }

    #[test]
    fn resolves_transparent_tls_targets_from_host_header() {
        let request = hyper::Request::builder()
            .method("GET")
            .uri("/backend-api/codex/models")
            .header("host", "chatgpt.com")
            .body(())
            .expect("transparent TLS request should build");
        let (parts, ()) = request.into_parts();

        let target = resolve_request_target(
            &parts,
            Some(&RequestTargetOverride {
                scheme: "https",
                default_authority: "203.0.113.20:443".to_string(),
            }),
        )
        .expect("transparent TLS target should resolve");

        assert_eq!(target.authority, "chatgpt.com");
        assert_eq!(target.host, "chatgpt.com");
        assert_eq!(
            target.uri.to_string(),
            "https://chatgpt.com/backend-api/codex/models"
        );
    }

    #[test]
    fn resolves_transparent_targets_from_original_destination_when_host_header_is_absent() {
        let request = hyper::Request::builder()
            .method("GET")
            .uri("/v1/models?limit=1")
            .body(())
            .expect("transparent request should build");
        let (parts, ()) = request.into_parts();

        let target = resolve_request_target(
            &parts,
            Some(&RequestTargetOverride {
                scheme: "http",
                default_authority: "203.0.113.10:80".to_string(),
            }),
        )
        .expect("transparent fallback target should resolve");

        assert_eq!(target.authority, "203.0.113.10:80");
        assert_eq!(target.host, "203.0.113.10");
        assert_eq!(
            target.uri.to_string(),
            "http://203.0.113.10:80/v1/models?limit=1"
        );
    }

    #[test]
    fn classifies_transparent_proxy_protocol_from_first_byte() {
        assert_eq!(
            classify_transparent_proxy_first_byte(0x16),
            TransparentProxyProtocol::Tls
        );
        assert_eq!(
            classify_transparent_proxy_first_byte(b'G'),
            TransparentProxyProtocol::PlainHttp
        );
        assert_eq!(
            classify_transparent_proxy_first_byte(b'P'),
            TransparentProxyProtocol::PlainHttp
        );
        assert_eq!(
            classify_transparent_proxy_first_byte(0x00),
            TransparentProxyProtocol::Unsupported
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn decodes_linux_original_destination_socket_addresses() {
        let expected_address = std::net::Ipv4Addr::new(203, 0, 113, 10);
        let sockaddr = nix::libc::sockaddr_in {
            sin_family: nix::libc::AF_INET as nix::libc::sa_family_t,
            sin_port: 443_u16.to_be(),
            sin_addr: nix::libc::in_addr {
                s_addr: u32::from(expected_address).to_be(),
            },
            sin_zero: [0; 8],
        };
        let mut storage = std::mem::MaybeUninit::<nix::libc::sockaddr_storage>::zeroed();
        unsafe {
            storage
                .as_mut_ptr()
                .cast::<nix::libc::sockaddr_in>()
                .write(sockaddr);
        }

        let decoded = socket_addr_from_sockaddr_storage(
            unsafe { storage.assume_init() },
            std::mem::size_of::<nix::libc::sockaddr_in>()
                .try_into()
                .expect("sockaddr_in length should fit socklen_t"),
        )
        .expect("IPv4 original destination should decode");

        assert_eq!(decoded, SocketAddr::from((expected_address, 443)));
    }

    #[test]
    fn managed_proxy_env_includes_proxy_and_ca_variables() {
        let env = build_managed_proxy_env(
            "127.0.0.1:4819"
                .parse()
                .expect("socket address should parse"),
            std::path::Path::new("/run/mistle/sandboxd/egress-proxy-ca-bundle.pem"),
            Some("http://tokenizer-proxy:5205/tokenizer-proxy/egress"),
        )
        .expect("managed proxy environment should build");

        assert_eq!(
            env.get("HTTPS_PROXY"),
            Some(&"http://127.0.0.1:4819".to_string())
        );
        assert_eq!(
            env.get("NO_PROXY"),
            Some(&"127.0.0.1,localhost,tokenizer-proxy,tokenizer-proxy:5205".to_string())
        );
        assert_eq!(
            env.get("SSL_CERT_FILE"),
            Some(&"/run/mistle/sandboxd/egress-proxy-ca-bundle.pem".to_string())
        );
        assert_eq!(
            env.get("NIX_SSL_CERT_FILE"),
            Some(&"/run/mistle/sandboxd/egress-proxy-ca-bundle.pem".to_string())
        );
        assert!(EgressProxy::managed_env_keys().contains(&"HTTPS_PROXY"));
        assert!(EgressProxy::managed_env_keys().contains(&"NODE_EXTRA_CA_CERTS"));
        assert!(EgressProxy::managed_env_keys().contains(&"NIX_SSL_CERT_FILE"));
    }

    #[test]
    fn gateway_proxy_env_does_not_bypass_tokenizer_proxy_host() {
        let env = build_managed_proxy_env(
            "127.0.0.1:4819"
                .parse()
                .expect("socket address should parse"),
            std::path::Path::new("/run/mistle/sandboxd/egress-proxy-ca-bundle.pem"),
            None,
        )
        .expect("managed proxy environment should build");

        assert_eq!(
            env.get("NO_PROXY"),
            Some(&"127.0.0.1,localhost".to_string())
        );
    }

    #[test]
    fn gateway_proxy_routes_do_not_require_local_egress_grants() {
        let runtime_plan = sample_runtime_plan();
        let route = super::build_gateway_proxy_route(&runtime_plan.egress_routes[0])
            .expect("gateway proxy route should build");

        assert_eq!(route.egress_rule_id, "egress-rule-1");
        assert_eq!(route.host, "api.openai.com");
        assert_eq!(route.grant, None);
    }

    #[test]
    fn refresh_grants_replaces_route_grants_without_restarting_proxy() {
        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let runtime_plan = sample_runtime_plan();
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url:
                    "http://tokenizer-proxy:5205/tokenizer-proxy/egress".to_string(),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle,
        )
        .expect("egress proxy start should succeed")
        .expect("egress proxy should be configured");
        let stable_proxy_url = proxy
            .runtime_env()
            .get("HTTPS_PROXY")
            .cloned()
            .expect("proxy env should include HTTPS_PROXY");
        let refreshed_startup_input = startup_input_with_grant("grant-2");

        proxy
            .refresh_grants(
                &runtime_plan,
                &refreshed_startup_input.egress_grant_by_rule_id,
            )
            .expect("grant refresh should succeed for unchanged route definitions");

        let routes = proxy
            .routes
            .read()
            .expect("route table should not be poisoned");
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].grant.as_deref(), Some("grant-2"));
        assert_eq!(
            proxy.runtime_env().get("HTTPS_PROXY"),
            Some(&stable_proxy_url),
            "refresh should not replace the local proxy listener"
        );
        drop(routes);

        proxy.close().expect("egress proxy close should succeed");
        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    #[test]
    fn refresh_grants_rejects_route_definition_changes() {
        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let runtime_plan = sample_runtime_plan();
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url:
                    "http://tokenizer-proxy:5205/tokenizer-proxy/egress".to_string(),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle,
        )
        .expect("egress proxy start should succeed")
        .expect("egress proxy should be configured");
        let mut changed_runtime_plan = sample_runtime_plan();
        changed_runtime_plan.egress_routes[0].r#match.path_prefixes = Some(vec!["/v2".to_string()]);
        let refreshed_startup_input = startup_input_with_grant("grant-2");

        let error = proxy
            .refresh_grants(
                &changed_runtime_plan,
                &refreshed_startup_input.egress_grant_by_rule_id,
            )
            .expect_err("grant refresh should reject route definition changes");

        assert!(
            error
                .to_string()
                .contains("cannot change route 'egress-rule-1' definition"),
            "unexpected refresh error: {error}"
        );
        let routes = proxy
            .routes
            .read()
            .expect("route table should not be poisoned");
        assert_eq!(routes[0].grant.as_deref(), Some("grant-1"));
        drop(routes);

        proxy.close().expect("egress proxy close should succeed");
        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    #[test]
    fn serializes_structured_egress_proxy_logs() {
        let clock = MutableClock::new(1_750_000_000_000);

        let serialized = serialize_egress_proxy_log_line(
            &clock,
            "sandbox-123",
            "egress_proxy_request_started",
            &[("requestId", Value::String("egp_1".to_string()))],
        )
        .expect("egress proxy log should serialize");

        let parsed: Value =
            serde_json::from_str(&serialized).expect("egress proxy log should be valid json");
        assert_eq!(parsed["event"], "egress_proxy_request_started");
        assert_eq!(parsed["sandboxInstanceId"], "sandbox-123");
        assert_eq!(parsed["component"], "EgressProxy");
        assert_eq!(parsed["requestId"], "egp_1");
        assert!(parsed["observedAt"].as_str().is_some());
    }

    #[test]
    fn streams_managed_proxy_responses_without_buffering_the_full_body() {
        let tokenizer_listener =
            StdTcpListener::bind(("127.0.0.1", 0)).expect("tokenizer listener should bind");
        let tokenizer_address = tokenizer_listener
            .local_addr()
            .expect("tokenizer listener should expose its address");
        let (request_sender, request_receiver) = mpsc::channel();
        let (release_second_chunk_sender, release_second_chunk_receiver) = mpsc::channel();
        let tokenizer_thread = thread::spawn(move || {
            let (mut stream, _) = tokenizer_listener
                .accept()
                .expect("tokenizer listener should accept one connection");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("tokenizer stream read timeout should set");
            let request_head = read_http_head(&mut stream);
            request_sender
                .send(request_head.clone())
                .expect("request head should send");

            stream
                .write_all(
                    concat!(
                        "HTTP/1.1 200 OK\r\n",
                        "content-type: text/event-stream\r\n",
                        "x-mistle-trace-id: trace_123\r\n",
                        "transfer-encoding: chunked\r\n",
                        "\r\n"
                    )
                    .as_bytes(),
                )
                .expect("response headers should write");
            stream
                .write_all(b"6\r\nhello \r\n")
                .expect("first chunk should write");
            stream.flush().expect("first chunk should flush");

            release_second_chunk_receiver
                .recv_timeout(Duration::from_secs(5))
                .expect("test should release second chunk");

            stream
                .write_all(b"5\r\nworld\r\n0\r\n\r\n")
                .expect("remaining chunks should write");
            stream.flush().expect("remaining chunks should flush");
        });

        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let runtime_plan = sample_runtime_plan();
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url: format!(
                    "http://{tokenizer_address}/tokenizer-proxy/egress"
                ),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle,
        )
        .expect("egress proxy start should succeed")
        .expect("egress proxy should be configured");

        let proxy_url = proxy
            .runtime_env()
            .get("HTTPS_PROXY")
            .cloned()
            .expect("proxy env should include HTTPS_PROXY");
        let ca_certificate_pem = fs::read(&proxy_ca_paths.runtime_certificate_path)
            .expect("proxy CA certificate should be readable");
        let ca_certificate =
            reqwest::Certificate::from_pem(&ca_certificate_pem).expect("proxy CA should parse");
        let client = reqwest::blocking::Client::builder()
            .proxy(Proxy::https(&proxy_url).expect("proxy url should parse"))
            .add_root_certificate(ca_certificate)
            .build()
            .expect("reqwest client should build");

        let mut response = client
            .post("https://api.openai.com/v1/responses?stream=true")
            .body(r#"{"stream":true}"#)
            .send()
            .expect("managed request should succeed");
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("x-mistle-trace-id")
                .and_then(|value| value.to_str().ok()),
            Some("trace_123")
        );
        assert!(
            response
                .headers()
                .contains_key(SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME),
            "response should include a sandbox egress correlation header"
        );

        let forwarded_request = request_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("tokenizer server should receive the proxied request");
        assert!(
            forwarded_request
                .starts_with("POST /tokenizer-proxy/egress/v1/responses?stream=true HTTP/1.1"),
            "expected managed route rewrite, got: {forwarded_request}"
        );
        assert!(
            forwarded_request
                .to_ascii_lowercase()
                .contains("x-mistle-egress-grant: grant-1"),
            "expected egress grant header in forwarded request, got: {forwarded_request}"
        );

        let mut first_chunk = [0_u8; 6];
        response
            .read_exact(&mut first_chunk)
            .expect("first streamed chunk should be readable before upstream completes");
        assert_eq!(&first_chunk, b"hello ");

        release_second_chunk_sender
            .send(())
            .expect("second chunk release should send");
        let mut rest = String::new();
        response
            .read_to_string(&mut rest)
            .expect("remaining streamed response should read");
        assert_eq!(rest, "world");

        proxy.close().expect("egress proxy close should succeed");
        tokenizer_thread
            .join()
            .expect("tokenizer thread should exit cleanly");
        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    #[test]
    fn tunnels_managed_websocket_upgrade_requests() {
        let tokenizer_listener =
            StdTcpListener::bind(("127.0.0.1", 0)).expect("tokenizer listener should bind");
        let tokenizer_address = tokenizer_listener
            .local_addr()
            .expect("tokenizer listener should expose its address");
        let (request_sender, request_receiver) = mpsc::channel();
        let tokenizer_thread = thread::spawn(move || {
            let (mut stream, _) = tokenizer_listener
                .accept()
                .expect("tokenizer listener should accept one connection");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("tokenizer stream read timeout should set");
            let request_head = read_http_head(&mut stream);
            request_sender
                .send(request_head.clone())
                .expect("request head should send");

            stream
                .write_all(
                    concat!(
                        "HTTP/1.1 101 Switching Protocols\r\n",
                        "connection: Upgrade\r\n",
                        "upgrade: websocket\r\n",
                        "sec-websocket-accept: test-accept\r\n",
                        "\r\n"
                    )
                    .as_bytes(),
                )
                .expect("upgrade response should write");
            stream.flush().expect("upgrade response should flush");

            let mut tunneled_payload = [0_u8; 12];
            stream
                .read_exact(&mut tunneled_payload)
                .expect("tunneled client payload should be readable");
            assert_eq!(&tunneled_payload, b"ping-through");
            stream
                .write_all(b"pong-through")
                .expect("tunneled server payload should write");
            stream
                .flush()
                .expect("tunneled server payload should flush");
        });

        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let mut runtime_plan = sample_runtime_plan();
        runtime_plan.egress_routes[0].r#match.methods = Some(vec!["GET".to_string()]);
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url: format!(
                    "http://{tokenizer_address}/tokenizer-proxy/egress"
                ),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle,
        )
        .expect("egress proxy start should succeed")
        .expect("egress proxy should be configured");

        let proxy_url = proxy
            .runtime_env()
            .get("HTTP_PROXY")
            .cloned()
            .expect("proxy env should include HTTP_PROXY");
        let proxy_address = proxy_url
            .strip_prefix("http://")
            .expect("proxy url should use http scheme");
        let mut client_stream =
            std::net::TcpStream::connect(proxy_address).expect("client should connect to proxy");
        client_stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("client stream read timeout should set");
        client_stream
            .write_all(
                concat!(
                    "GET http://api.openai.com/v1/responses HTTP/1.1\r\n",
                    "host: api.openai.com\r\n",
                    "connection: Upgrade\r\n",
                    "upgrade: websocket\r\n",
                    "sec-websocket-key: test-key\r\n",
                    "sec-websocket-version: 13\r\n",
                    "\r\n"
                )
                .as_bytes(),
            )
            .expect("upgrade request should write");

        let response_head = read_http_head(&mut client_stream);
        assert!(
            response_head.starts_with("HTTP/1.1 101 Switching Protocols\r\n"),
            "expected switching protocols response, got: {response_head}"
        );
        assert!(
            response_head
                .to_ascii_lowercase()
                .contains("upgrade: websocket"),
            "expected websocket upgrade header, got: {response_head}"
        );
        assert!(
            response_head
                .to_ascii_lowercase()
                .contains(SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME),
            "expected sandbox egress correlation header, got: {response_head}"
        );

        let forwarded_request = request_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("tokenizer server should receive the proxied websocket request");
        assert!(
            forwarded_request.starts_with("GET /tokenizer-proxy/egress/v1/responses HTTP/1.1"),
            "expected managed route rewrite, got: {forwarded_request}"
        );
        assert!(
            forwarded_request
                .to_ascii_lowercase()
                .contains("connection: upgrade"),
            "expected connection upgrade header in forwarded request, got: {forwarded_request}"
        );
        assert!(
            forwarded_request
                .to_ascii_lowercase()
                .contains("upgrade: websocket"),
            "expected websocket upgrade header in forwarded request, got: {forwarded_request}"
        );
        assert!(
            forwarded_request
                .to_ascii_lowercase()
                .contains("x-mistle-egress-grant: grant-1"),
            "expected egress grant header in forwarded request, got: {forwarded_request}"
        );

        client_stream
            .write_all(b"ping-through")
            .expect("tunneled client payload should write");
        client_stream
            .flush()
            .expect("tunneled client payload should flush");
        let mut tunneled_response = [0_u8; 12];
        client_stream
            .read_exact(&mut tunneled_response)
            .expect("tunneled server payload should be readable");
        assert_eq!(&tunneled_response, b"pong-through");

        proxy.close().expect("egress proxy close should succeed");
        tokenizer_thread
            .join()
            .expect("tokenizer thread should exit cleanly");
        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    #[test]
    fn tunnels_managed_websocket_upgrade_requests_through_connect_tls() {
        let tokenizer_listener =
            StdTcpListener::bind(("127.0.0.1", 0)).expect("tokenizer listener should bind");
        let tokenizer_address = tokenizer_listener
            .local_addr()
            .expect("tokenizer listener should expose its address");
        let (request_sender, request_receiver) = mpsc::channel();
        let tokenizer_thread = thread::spawn(move || {
            let (mut stream, _) = tokenizer_listener
                .accept()
                .expect("tokenizer listener should accept one connection");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("tokenizer stream read timeout should set");
            let request_head = read_http_head(&mut stream);
            request_sender
                .send(request_head.clone())
                .expect("request head should send");

            stream
                .write_all(
                    concat!(
                        "HTTP/1.1 101 Switching Protocols\r\n",
                        "connection: Upgrade\r\n",
                        "upgrade: websocket\r\n",
                        "sec-websocket-accept: test-accept\r\n",
                        "\r\n"
                    )
                    .as_bytes(),
                )
                .expect("upgrade response should write");
            stream.flush().expect("upgrade response should flush");

            let mut tunneled_payload = [0_u8; 12];
            stream
                .read_exact(&mut tunneled_payload)
                .expect("tunneled client payload should be readable");
            assert_eq!(&tunneled_payload, b"ping-through");
            stream
                .write_all(b"pong-through")
                .expect("tunneled server payload should write");
            stream
                .flush()
                .expect("tunneled server payload should flush");
        });

        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let mut runtime_plan = sample_runtime_plan();
        runtime_plan.egress_routes[0].r#match.methods = Some(vec!["GET".to_string()]);
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url: format!(
                    "http://{tokenizer_address}/tokenizer-proxy/egress"
                ),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle,
        )
        .expect("egress proxy start should succeed")
        .expect("egress proxy should be configured");

        let proxy_url = proxy
            .runtime_env()
            .get("HTTPS_PROXY")
            .cloned()
            .expect("proxy env should include HTTPS_PROXY");
        let proxy_address = proxy_url
            .strip_prefix("http://")
            .expect("proxy url should use http scheme");
        let mut client_stream =
            std::net::TcpStream::connect(proxy_address).expect("client should connect to proxy");
        client_stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("client stream read timeout should set");
        client_stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .expect("client stream write timeout should set");
        client_stream
            .write_all(
                concat!(
                    "CONNECT api.openai.com:443 HTTP/1.1\r\n",
                    "host: api.openai.com:443\r\n",
                    "\r\n"
                )
                .as_bytes(),
            )
            .expect("CONNECT request should write");

        let connect_response = read_http_head(&mut client_stream);
        assert!(
            connect_response.starts_with("HTTP/1.1 200 "),
            "expected CONNECT acknowledgement, got: {connect_response}"
        );

        let ca_certificate_pem = fs::read(&proxy_ca_paths.runtime_certificate_path)
            .expect("proxy CA certificate should be readable");
        let ca_certificate = CertificateDer::from_pem_slice(&ca_certificate_pem)
            .expect("proxy CA certificate should parse");
        let mut root_store = RootCertStore::empty();
        root_store
            .add(ca_certificate)
            .expect("proxy CA certificate should install in test root store");
        let client_config = ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();
        let server_name = ServerName::try_from("api.openai.com")
            .expect("server name should parse")
            .to_owned();
        let client_connection = ClientConnection::new(Arc::new(client_config), server_name)
            .expect("TLS client connection should build");
        let mut tls_stream = StreamOwned::new(client_connection, client_stream);

        tls_stream
            .write_all(
                concat!(
                    "GET /v1/responses HTTP/1.1\r\n",
                    "host: api.openai.com\r\n",
                    "connection: Upgrade\r\n",
                    "upgrade: websocket\r\n",
                    "sec-websocket-key: test-key\r\n",
                    "sec-websocket-version: 13\r\n",
                    "\r\n"
                )
                .as_bytes(),
            )
            .expect("upgrade request should write");

        let response_head = read_http_head(&mut tls_stream);
        assert!(
            response_head.starts_with("HTTP/1.1 101 Switching Protocols\r\n"),
            "expected switching protocols response, got: {response_head}"
        );
        assert!(
            response_head
                .to_ascii_lowercase()
                .contains("upgrade: websocket"),
            "expected websocket upgrade header, got: {response_head}"
        );
        assert!(
            response_head
                .to_ascii_lowercase()
                .contains(SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME),
            "expected sandbox egress correlation header, got: {response_head}"
        );

        let forwarded_request = request_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("tokenizer server should receive the proxied websocket request");
        assert!(
            forwarded_request.starts_with("GET /tokenizer-proxy/egress/v1/responses HTTP/1.1"),
            "expected managed route rewrite, got: {forwarded_request}"
        );
        assert!(
            forwarded_request
                .to_ascii_lowercase()
                .contains("connection: upgrade"),
            "expected connection upgrade header in forwarded request, got: {forwarded_request}"
        );
        assert!(
            forwarded_request
                .to_ascii_lowercase()
                .contains("upgrade: websocket"),
            "expected websocket upgrade header in forwarded request, got: {forwarded_request}"
        );
        assert!(
            forwarded_request
                .to_ascii_lowercase()
                .contains("x-mistle-egress-grant: grant-1"),
            "expected egress grant header in forwarded request, got: {forwarded_request}"
        );

        tls_stream
            .write_all(b"ping-through")
            .expect("tunneled client payload should write");
        tls_stream
            .flush()
            .expect("tunneled client payload should flush");
        let mut tunneled_response = [0_u8; 12];
        tls_stream
            .read_exact(&mut tunneled_response)
            .expect("tunneled server payload should be readable");
        assert_eq!(&tunneled_response, b"pong-through");

        proxy.close().expect("egress proxy close should succeed");
        tokenizer_thread
            .join()
            .expect("tokenizer thread should exit cleanly");
        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    #[test]
    fn keeps_a_stable_proxy_address_across_close_and_restart() {
        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let runtime_plan = sample_runtime_plan();
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy_one = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url:
                    "http://tokenizer-proxy:5205/tokenizer-proxy/egress".to_string(),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle.clone(),
        )
        .expect("first egress proxy start should succeed")
        .expect("egress proxy should be configured");
        let proxy_one_address = proxy_one
            .runtime_env()
            .get("HTTPS_PROXY")
            .cloned()
            .expect("proxy env should include HTTPS_PROXY");
        assert_eq!(proxy_one_address, format!("http://{listener_address}"));
        proxy_one
            .close()
            .expect("first egress proxy close should succeed");

        let proxy_two = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url:
                    "http://tokenizer-proxy:5205/tokenizer-proxy/egress".to_string(),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle.clone(),
        )
        .expect("second egress proxy start should succeed")
        .expect("egress proxy should still be configured");
        let proxy_two_address = proxy_two
            .runtime_env()
            .get("HTTPS_PROXY")
            .cloned()
            .expect("proxy env should include HTTPS_PROXY");
        assert_eq!(proxy_two_address, proxy_one_address);
        let snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::EgressProxy)
            .expect("egress proxy should be tracked");
        assert_eq!(
            snapshot.details.get("listenAddr"),
            Some(&listener_address.to_string())
        );
        assert_eq!(
            snapshot.details.get("stablePort"),
            Some(&listener_address.port().to_string())
        );
        proxy_two
            .close()
            .expect("second egress proxy close should succeed");
        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    #[test]
    fn restarts_the_proxy_after_the_live_server_exits() {
        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let runtime_plan = sample_runtime_plan();
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url:
                    "http://tokenizer-proxy:5205/tokenizer-proxy/egress".to_string(),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle.clone(),
        )
        .expect("egress proxy start should succeed")
        .expect("egress proxy should be configured");
        let stable_proxy_url = proxy
            .runtime_env()
            .get("HTTPS_PROXY")
            .cloned()
            .expect("proxy env should include HTTPS_PROXY");

        proxy
            .force_current_server_shutdown_for_test()
            .expect("forced shutdown command should reach the supervisor");
        wait_for_egress_snapshot(
            &supervisor_handle,
            ComponentHealthState::Healthy,
            1,
            Duration::from_secs(5),
        );
        assert_eq!(
            proxy.runtime_env().get("HTTPS_PROXY"),
            Some(&stable_proxy_url)
        );
        proxy.close().expect("egress proxy close should succeed");
        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    #[test]
    fn installs_combined_ca_bundle_and_removes_proxy_ca_files_while_refreshing_the_trust_store() {
        let listener_address = reserve_test_listener_address();
        let proxy_ca_paths = test_proxy_ca_paths();
        let runtime_plan = sample_runtime_plan();
        let startup_input = sample_startup_input();
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sandbox-123",
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::EgressProxy]),
        );

        let proxy = EgressProxy::start_with_options(
            &runtime_plan,
            &startup_input,
            EgressProxyForwardingMode::TokenizerProxy {
                tokenizer_proxy_egress_base_url:
                    "http://tokenizer-proxy:5205/tokenizer-proxy/egress".to_string(),
            },
            listener_address,
            test_proxy_ca_config(&proxy_ca_paths),
            Arc::new(SystemClock),
            supervisor_handle,
        )
        .expect("egress proxy start should succeed")
        .expect("egress proxy should be configured");

        assert_eq!(
            fs::read(&proxy_ca_paths.runtime_certificate_path)
                .expect("runtime proxy CA certificate should exist"),
            fs::read(&proxy_ca_paths.trust_store_certificate_path)
                .expect("trust store proxy CA certificate should exist")
        );
        let runtime_certificate = fs::read_to_string(&proxy_ca_paths.runtime_certificate_path)
            .expect("runtime proxy CA certificate should be readable");
        let runtime_certificate_bundle =
            fs::read_to_string(&proxy_ca_paths.runtime_certificate_bundle_path)
                .expect("runtime proxy CA bundle should exist");
        assert!(
            runtime_certificate_bundle.starts_with("system-root\n"),
            "runtime proxy CA bundle should preserve system roots"
        );
        assert!(
            runtime_certificate_bundle.ends_with(&runtime_certificate),
            "runtime proxy CA bundle should append the local proxy CA"
        );
        assert_eq!(
            count_refresh_events(&proxy_ca_paths.refresh_marker_path),
            1,
            "startup should refresh the trust store once"
        );

        proxy.close().expect("egress proxy close should succeed");

        assert!(
            !proxy_ca_paths.runtime_certificate_path.exists(),
            "runtime proxy CA certificate should be removed during cleanup"
        );
        assert!(
            !proxy_ca_paths.runtime_certificate_bundle_path.exists(),
            "runtime proxy CA bundle should be removed during cleanup"
        );
        assert!(
            !proxy_ca_paths.trust_store_certificate_path.exists(),
            "trust store proxy CA certificate should be removed during cleanup"
        );
        assert_eq!(
            count_refresh_events(&proxy_ca_paths.refresh_marker_path),
            2,
            "cleanup should refresh the trust store after removing the certificate"
        );

        let _ = fs::remove_dir_all(&proxy_ca_paths.root_directory);
    }

    fn reserve_test_listener_address() -> SocketAddr {
        let listener = StdTcpListener::bind(("127.0.0.1", 0))
            .expect("test listener should bind to an ephemeral loopback port");
        let listener_address = listener
            .local_addr()
            .expect("test listener should expose its bound address");
        drop(listener);
        listener_address
    }

    fn sample_runtime_plan() -> CompiledRuntimePlan {
        CompiledRuntimePlan {
            image: crate::runtime::CompiledRuntimePlanImage {
                source: crate::runtime::CompiledRuntimePlanImageSource::Base,
                image_ref: "registry.example.test/base:latest".to_string(),
            },
            setup_script: None,
            egress_routes: vec![CompiledEgressRoute {
                egress_rule_id: "egress-rule-1".to_string(),
                binding_id: "binding-1".to_string(),
                family_id: "family-1".to_string(),
                variant_id: "variant-1".to_string(),
                r#match: CompiledEgressRouteMatch {
                    hosts: vec!["api.openai.com".to_string()],
                    path_prefixes: Some(vec!["/v1".to_string()]),
                    methods: Some(vec!["POST".to_string()]),
                },
                upstream: CompiledEgressRouteUpstream {
                    base_url: "https://api.openai.com".to_string(),
                },
                auth_injection: CompiledEgressRouteAuthInjection {
                    r#type: CompiledEgressRouteAuthInjectionType::Bearer,
                    target: None,
                    username: None,
                    service: None,
                    region: None,
                },
                additional_headers: None,
                additional_credential_headers: None,
                credential_resolver: CompiledEgressRouteCredentialResolver::IntegrationConnection {
                    connection_id: "connection-1".to_string(),
                    secret_type: "token".to_string(),
                    slot_key: None,
                    resolver_key: None,
                },
                request_middleware: None,
            }],
            artifacts: Vec::new(),
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        }
    }

    fn sample_startup_input() -> StartupInput {
        startup_input_with_grant("grant-1")
    }

    fn startup_input_with_grant(grant: &str) -> StartupInput {
        StartupInput {
            startup_mode: StartupMode::New,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "exchange-token".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:4500/tunnel/sandbox/sandbox-123".to_string(),
            runtime_plan: serde_json::json!({}),
            egress_grant_by_rule_id: BTreeMap::from([(
                "egress-rule-1".to_string(),
                grant.to_string(),
            )]),
            git_identity: None,
        }
    }

    fn test_proxy_ca_paths() -> TestProxyCaPaths {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let counter = TEST_PROXY_CA_PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
        let root_directory =
            std::env::temp_dir().join(format!("mistle-egress-proxy-test-{unique_id}-{counter}"));
        let system_certificate_bundle_path =
            root_directory.join("etc/ssl/certs/ca-certificates.crt");
        let runtime_certificate_path =
            root_directory.join("run/mistle/sandboxd/egress-proxy-ca.pem");
        let runtime_certificate_bundle_path =
            root_directory.join("run/mistle/sandboxd/egress-proxy-ca-bundle.pem");
        let trust_store_certificate_path =
            root_directory.join("usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt");
        let refresh_marker_path = root_directory.join("update-ca-certificates.log");
        let refresh_command_path = root_directory.join("bin/update-ca-certificates");
        fs::create_dir_all(
            system_certificate_bundle_path
                .parent()
                .expect("system certificate bundle path should have a parent directory"),
        )
        .expect("system certificate bundle directory should be creatable");
        fs::write(&system_certificate_bundle_path, "system-root\n")
            .expect("system certificate bundle should be writable");
        fs::create_dir_all(
            refresh_command_path
                .parent()
                .expect("refresh command path should have a parent directory"),
        )
        .expect("refresh command directory should be creatable");
        fs::write(
            &refresh_command_path,
            format!(
                "#!/bin/sh\nprintf 'refresh\\n' >> '{}'\n",
                refresh_marker_path.display()
            ),
        )
        .expect("refresh command script should be writable");
        let mut permissions = fs::metadata(&refresh_command_path)
            .expect("refresh command metadata should be readable")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&refresh_command_path, permissions)
            .expect("refresh command should be executable");

        TestProxyCaPaths {
            root_directory,
            system_certificate_bundle_path,
            runtime_certificate_path,
            runtime_certificate_bundle_path,
            trust_store_certificate_path,
            refresh_command_path,
            refresh_marker_path,
        }
    }

    fn test_proxy_ca_config(proxy_ca_paths: &TestProxyCaPaths) -> ProxyCaConfig<'_> {
        ProxyCaConfig {
            runtime_certificate_path: &proxy_ca_paths.runtime_certificate_path,
            runtime_certificate_bundle_path: &proxy_ca_paths.runtime_certificate_bundle_path,
            trust_store_certificate_path: &proxy_ca_paths.trust_store_certificate_path,
            system_certificate_bundle_path: &proxy_ca_paths.system_certificate_bundle_path,
            refresh_command: &proxy_ca_paths.refresh_command_path,
        }
    }

    fn count_refresh_events(marker_path: &std::path::Path) -> usize {
        fs::read_to_string(marker_path)
            .unwrap_or_default()
            .lines()
            .count()
    }

    fn wait_for_egress_snapshot(
        supervisor_handle: &SandboxdSupervisorHandle,
        expected_state: ComponentHealthState,
        expected_restart_count: u64,
        timeout: Duration,
    ) {
        let deadline = Instant::now() + timeout;
        loop {
            let snapshot = supervisor_handle
                .component_snapshot(SupervisedComponent::EgressProxy)
                .expect("egress proxy should be tracked");
            if snapshot.state == expected_state && snapshot.restart_count >= expected_restart_count
            {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "expected egress proxy snapshot to reach state {expected_state:?} with restart_count >= {expected_restart_count}, got {snapshot:?}"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    fn read_http_head(stream: &mut impl Read) -> String {
        let mut buffer = Vec::new();
        let mut byte = [0_u8; 1];
        while !buffer.ends_with(b"\r\n\r\n") {
            stream
                .read_exact(&mut byte)
                .expect("http request head should be readable");
            buffer.push(byte[0]);
        }
        String::from_utf8(buffer).expect("http request head should be utf-8")
    }
}
