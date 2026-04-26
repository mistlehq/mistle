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
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, TryRecvError};
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
use tokio::net::TcpListener;
use tokio::runtime::Builder;
use tokio::sync::oneshot;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::ServerConfig;

use crate::protocol::startup::StartupInput;
use crate::proxy_ca::{generate_proxy_ca, issue_proxy_leaf_certificate};
use crate::runtime::{CompiledEgressRoute, CompiledRuntimePlan};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, SystemClock, format_rfc3339_timestamp};

const TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME: &str = "X-Mistle-Egress-Grant";
const RUNTIME_PROXY_CA_CERT_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca.pem";
const RUNTIME_PROXY_CA_TRUST_STORE_PATH: &str =
    "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt";
const UPDATE_CA_CERTIFICATES_COMMAND: &str = "update-ca-certificates";
const DEFAULT_LOOPBACK_PROXY_PORT: u16 = 38_513;
const EGRESS_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(250);
const EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);
const EGRESS_PROXY_RESTART_BACKOFF_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 5000];
const RUNTIME_NO_PROXY_DEFAULTS: [&str; 2] = ["127.0.0.1", "localhost"];
const SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME: &str = "x-mistle-sandbox-egress-id";

const MANAGED_PROXY_ENV_KEYS: [&str; 15] = [
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
    "SSL_CERT_DIR",
    "GIT_SSL_CAPATH",
];

type BoxError = Box<dyn std::error::Error + Send + Sync>;
type HyperBody = BoxBody<Bytes, BoxError>;
type EgressConnector = HttpsConnector<HttpConnector>;

#[derive(Clone, Copy)]
struct ProxyCaConfig<'a> {
    runtime_certificate_path: &'a Path,
    trust_store_certificate_path: &'a Path,
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
    shutdown_requested: Arc<AtomicBool>,
    supervisor_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
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
    grant: String,
}

#[derive(Clone)]
struct EgressProxyState {
    sandbox_instance_id: String,
    tokenizer_proxy_egress_base_url: String,
    routes: Arc<Vec<EgressProxyRoute>>,
    client: Client<EgressConnector, Incoming>,
    proxy_ca_certificate_pem: Arc<String>,
    proxy_ca_private_key_pem: Arc<String>,
    clock: Arc<dyn Clock>,
    next_request_id: Arc<AtomicU64>,
}

#[derive(Debug)]
struct ProxyCaInstallation {
    runtime_certificate_path: PathBuf,
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
    inner: Incoming,
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

impl ProxyCaInstallation {
    fn install(
        proxy_ca_certificate_pem: &str,
        runtime_certificate_path: &Path,
        trust_store_certificate_path: &Path,
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

        let trust_store_directory = trust_store_certificate_path.parent().ok_or_else(|| {
            EgressProxyError::new("egress proxy trust store path must include a parent directory")
        })?;
        prepare_system_trust_store_directory(trust_store_directory)?;

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
                Poll::Ready(Some(Err(Box::new(error))))
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
        tokenizer_proxy_egress_base_url: &str,
        clock: Arc<dyn Clock>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Option<Self>, EgressProxyError> {
        Self::start_with_options(
            runtime_plan,
            startup_input,
            tokenizer_proxy_egress_base_url,
            default_loopback_proxy_listener_address(),
            ProxyCaConfig {
                runtime_certificate_path: Path::new(RUNTIME_PROXY_CA_CERT_PATH),
                trust_store_certificate_path: Path::new(RUNTIME_PROXY_CA_TRUST_STORE_PATH),
                refresh_command: Path::new(UPDATE_CA_CERTIFICATES_COMMAND),
            },
            clock,
            supervisor_handle,
        )
    }

    fn start_with_options(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        tokenizer_proxy_egress_base_url: &str,
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
            .map(|route| build_proxy_route(route, startup_input))
            .collect::<Result<Vec<_>, _>>()?;

        let generated_proxy_ca = generate_proxy_ca(clock.as_ref())
            .map_err(|error| EgressProxyError::new(error.to_string()))?;
        let proxy_ca_installation = match ProxyCaInstallation::install(
            &generated_proxy_ca.certificate_pem,
            proxy_ca_config.runtime_certificate_path,
            proxy_ca_config.trust_store_certificate_path,
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
        let state = EgressProxyState {
            sandbox_instance_id: supervisor_handle.sandbox_instance_id().to_string(),
            tokenizer_proxy_egress_base_url: tokenizer_proxy_egress_base_url.to_string(),
            routes: Arc::new(routes),
            client: Client::builder(TokioExecutor::new()).build(https_connector),
            proxy_ca_certificate_pem: Arc::new(generated_proxy_ca.certificate_pem.clone()),
            proxy_ca_private_key_pem: Arc::new(generated_proxy_ca.private_key_pem),
            clock,
            next_request_id: Arc::new(AtomicU64::new(1)),
        };

        let runtime_env = match build_managed_proxy_env(
            listener_address,
            proxy_ca_config.runtime_certificate_path,
            tokenizer_proxy_egress_base_url,
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
        let mut active_server = spawn_active_egress_proxy_server(std_listener, state.clone());
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
            #[cfg(any(test, debug_assertions))]
            supervisor_command_sender: Some(supervisor_command_sender),
            proxy_ca_installation,
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
) -> ActiveEgressProxyServer {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (exit_sender, exit_receiver) = mpsc::channel();
    let server_thread = thread::spawn(move || {
        let result = run_proxy_server(std_listener, shutdown_rx, state);
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
            spawn_active_egress_proxy_server(std_listener, config.state.clone());
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

fn build_proxy_route(
    route: &CompiledEgressRoute,
    startup_input: &StartupInput,
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
    let grant = startup_input
        .egress_grant_by_rule_id
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
        grant,
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
    tokenizer_proxy_egress_base_url: &str,
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
        ("NODE_EXTRA_CA_CERTS".to_string(), certificate_path),
    ]))
}

fn build_no_proxy_value(tokenizer_proxy_egress_base_url: &str) -> Result<String, EgressProxyError> {
    let tokenizer_proxy_url =
        url::Url::parse(tokenizer_proxy_egress_base_url).map_err(|error| {
            EgressProxyError::new(format!(
                "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' is invalid: {error}"
            ))
        })?;
    let tokenizer_proxy_host = tokenizer_proxy_url.host_str().ok_or_else(|| {
        EgressProxyError::new(format!(
            "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' must include a host"
        ))
    })?;

    let mut no_proxy_hosts = RUNTIME_NO_PROXY_DEFAULTS
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    no_proxy_hosts.push(tokenizer_proxy_host.to_string());
    if let Some(port) = tokenizer_proxy_url.port() {
        no_proxy_hosts.push(format!("{tokenizer_proxy_host}:{port}"));
    }

    Ok(no_proxy_hosts.join(","))
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

async fn handle_proxy_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    tunneled_authority: Option<String>,
) -> Result<Response<HyperBody>, Infallible> {
    if request.method() == Method::CONNECT {
        return Ok(handle_connect_request(request, state));
    }

    Ok(
        match forward_request(request, state, tunneled_authority).await {
            Ok(response) => response,
            Err(error) => text_response(StatusCode::BAD_GATEWAY, error.to_string()),
        },
    )
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
        let service = service_fn(move |request| {
            handle_proxy_request(request, state.clone(), Some(authority.clone()))
        });
        let _ = http1::Builder::new()
            .serve_connection(TokioIo::new(tls_stream), service)
            .await;
    });

    Response::builder()
        .status(StatusCode::OK)
        .body(empty_body())
        .expect("CONNECT acknowledgement response should build")
}

async fn forward_request(
    request: Request<Incoming>,
    state: EgressProxyState,
    tunneled_authority: Option<String>,
) -> Result<Response<HyperBody>, EgressProxyError> {
    let (parts, body) = request.into_parts();
    let request_method = parts.method.clone();
    let request_target = resolve_request_target(&parts, tunneled_authority.as_deref())?;
    let request_path_and_query = request_target
        .uri
        .path_and_query()
        .map_or("/", |path_and_query| path_and_query.as_str());
    let route = match_route(
        &state.routes,
        &request_target.host,
        request_path_and_query,
        request_method.as_str(),
    )?;
    let upstream_uri = match route {
        Some(_) => build_tokenizer_proxy_forward_uri(
            &state.tokenizer_proxy_egress_base_url,
            request_path_and_query,
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
        path_and_query: request_path_and_query.to_string(),
        route_mode: if route.is_some() { "managed" } else { "direct" },
        egress_rule_id: route.map(|matched_route| matched_route.egress_rule_id.clone()),
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
    let outbound_request = match route {
        Some(route) => outbound_request
            .header(
                TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME,
                route.grant.as_str(),
            )
            .body(body)
            .map_err(|error| {
                EgressProxyError::new(format!("failed to build proxied request: {error}"))
            })?,
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
            return Err(match route {
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
            inner: body,
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

fn resolve_request_target(
    request: &hyper::http::request::Parts,
    tunneled_authority: Option<&str>,
) -> Result<RequestTarget, EgressProxyError> {
    let authority = match tunneled_authority {
        Some(tunneled_authority) => tunneled_authority.to_string(),
        None => {
            if let Some(authority) = request.uri.authority() {
                authority.as_str().to_string()
            } else if let Some(host) = request.headers.get(HOST) {
                host.to_str()
                    .map(|value| value.to_string())
                    .map_err(|error| {
                        EgressProxyError::new(format!(
                            "proxied request host header is invalid: {error}"
                        ))
                    })?
            } else {
                return Err(EgressProxyError::new("proxied request is missing a host"));
            }
        }
    };
    let scheme = if tunneled_authority.is_some() {
        "https"
    } else {
        request.uri.scheme_str().unwrap_or("http")
    };
    let uri = match (
        request.uri.scheme(),
        request.uri.authority(),
        tunneled_authority,
    ) {
        (Some(_), Some(_), None) => request.uri.clone(),
        _ => build_direct_forward_uri(scheme, &authority, request.uri.path_and_query())?,
    };

    Ok(RequestTarget {
        host: normalize_authority_host(&authority),
        authority,
        uri,
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
    let issued_certificate = issue_proxy_leaf_certificate(
        proxy_ca_certificate_pem.to_string(),
        proxy_ca_private_key_pem.to_string(),
        authority.to_string(),
        clock,
    )
    .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let certificate_chain = load_certificate_chain(&issued_certificate.certificate_chain_pem)?;
    let private_key = load_private_key(&issued_certificate.private_key_pem)?;
    let server_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certificate_chain, private_key)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build local egress proxy certificate chain: {error}"
            ))
        })?;

    Ok(TlsAcceptor::from(Arc::new(server_config)))
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
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use crate::egress_proxy::{
        EgressProxy, EgressProxyRoute, ProxyCaConfig, SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME,
        build_direct_forward_uri, build_managed_proxy_env, join_url_path, match_route,
        serialize_egress_proxy_log_line,
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
    use serde_json::Value;

    struct TestProxyCaPaths {
        root_directory: PathBuf,
        runtime_certificate_path: PathBuf,
        trust_store_certificate_path: PathBuf,
        refresh_command_path: PathBuf,
        refresh_marker_path: PathBuf,
    }

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
                grant: "grant-a".to_string(),
            },
            EgressProxyRoute {
                egress_rule_id: "egress-rule-b".to_string(),
                upstream_base_url: "https://github.com".to_string(),
                host: "github.com".to_string(),
                path_prefixes: vec!["/mistlehq/mistle.git".to_string()],
                methods: Some(vec!["GET".to_string()]),
                grant: "grant-b".to_string(),
            },
        ];

        let graphql_route = match_route(&routes, "api.github.com", "/graphql", "POST")
            .expect("graphql route should match");
        assert_eq!(
            graphql_route
                .expect("graphql route should resolve exactly one match")
                .grant,
            "grant-a"
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
                .grant,
            "grant-b"
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
            grant: "grant-a".to_string(),
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
    fn managed_proxy_env_includes_proxy_and_ca_variables() {
        let env = build_managed_proxy_env(
            "127.0.0.1:4819"
                .parse()
                .expect("socket address should parse"),
            std::path::Path::new("/run/mistle/sandboxd/egress-proxy-ca.pem"),
            "http://tokenizer-proxy:5205/tokenizer-proxy/egress",
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
            Some(&"/run/mistle/sandboxd/egress-proxy-ca.pem".to_string())
        );
        assert!(EgressProxy::managed_env_keys().contains(&"HTTPS_PROXY"));
        assert!(EgressProxy::managed_env_keys().contains(&"NODE_EXTRA_CA_CERTS"));
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
            &format!("http://{tokenizer_address}/tokenizer-proxy/egress"),
            listener_address,
            ProxyCaConfig {
                runtime_certificate_path: &proxy_ca_paths.runtime_certificate_path,
                trust_store_certificate_path: &proxy_ca_paths.trust_store_certificate_path,
                refresh_command: &proxy_ca_paths.refresh_command_path,
            },
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
            "http://tokenizer-proxy:5205/tokenizer-proxy/egress",
            listener_address,
            ProxyCaConfig {
                runtime_certificate_path: &proxy_ca_paths.runtime_certificate_path,
                trust_store_certificate_path: &proxy_ca_paths.trust_store_certificate_path,
                refresh_command: &proxy_ca_paths.refresh_command_path,
            },
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
            "http://tokenizer-proxy:5205/tokenizer-proxy/egress",
            listener_address,
            ProxyCaConfig {
                runtime_certificate_path: &proxy_ca_paths.runtime_certificate_path,
                trust_store_certificate_path: &proxy_ca_paths.trust_store_certificate_path,
                refresh_command: &proxy_ca_paths.refresh_command_path,
            },
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
            "http://tokenizer-proxy:5205/tokenizer-proxy/egress",
            listener_address,
            ProxyCaConfig {
                runtime_certificate_path: &proxy_ca_paths.runtime_certificate_path,
                trust_store_certificate_path: &proxy_ca_paths.trust_store_certificate_path,
                refresh_command: &proxy_ca_paths.refresh_command_path,
            },
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
    fn installs_and_removes_proxy_ca_files_while_refreshing_the_trust_store() {
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
            "http://tokenizer-proxy:5205/tokenizer-proxy/egress",
            listener_address,
            ProxyCaConfig {
                runtime_certificate_path: &proxy_ca_paths.runtime_certificate_path,
                trust_store_certificate_path: &proxy_ca_paths.trust_store_certificate_path,
                refresh_command: &proxy_ca_paths.refresh_command_path,
            },
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
        StartupInput {
            startup_mode: StartupMode::New,
            execution_mode: crate::protocol::startup::StartupExecutionMode::Session,
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "exchange-token".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:4500/tunnel/sandbox/sandbox-123".to_string(),
            runtime_plan: serde_json::json!({}),
            egress_grant_by_rule_id: BTreeMap::from([(
                "egress-rule-1".to_string(),
                "grant-1".to_string(),
            )]),
            git_identity: None,
        }
    }

    fn test_proxy_ca_paths() -> TestProxyCaPaths {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root_directory =
            std::env::temp_dir().join(format!("mistle-egress-proxy-test-{unique_id}"));
        let runtime_certificate_path =
            root_directory.join("run/mistle/sandboxd/egress-proxy-ca.pem");
        let trust_store_certificate_path =
            root_directory.join("usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt");
        let refresh_marker_path = root_directory.join("update-ca-certificates.log");
        let refresh_command_path = root_directory.join("bin/update-ca-certificates");
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
            runtime_certificate_path,
            trust_store_certificate_path,
            refresh_command_path,
            refresh_marker_path,
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

    fn read_http_head(stream: &mut std::net::TcpStream) -> String {
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
