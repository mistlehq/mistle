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
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
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
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::runtime::Builder;
use tokio::sync::oneshot;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::ServerConfig;

use crate::protocol::startup::StartupInput;
use crate::proxy_ca::{generate_proxy_ca, issue_proxy_leaf_certificate};
use crate::runtime::{CompiledEgressRoute, CompiledRuntimePlan};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::Clock;

const TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME: &str = "X-Mistle-Egress-Grant";
const RUNTIME_PROXY_CA_CERT_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca.pem";
const DEFAULT_LOOPBACK_PROXY_PORT: u16 = 38_513;
const EGRESS_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(250);
const EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);
const EGRESS_PROXY_RESTART_BACKOFF_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 5000];
const RUNTIME_NO_PROXY_DEFAULTS: [&str; 2] = ["127.0.0.1", "localhost"];

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

type HyperBody = Full<Bytes>;
type EgressConnector = HttpsConnector<HttpConnector>;

#[derive(Debug)]
pub struct EgressProxy {
    runtime_env: BTreeMap<String, String>,
    shutdown_requested: Arc<AtomicBool>,
    supervisor_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
    #[cfg(any(test, debug_assertions))]
    supervisor_command_sender: Option<mpsc::Sender<EgressProxySupervisorCommand>>,
    ca_certificate_path: PathBuf,
    supervisor_handle: SandboxdSupervisorHandle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressProxyError {
    message: String,
}

#[derive(Debug, Clone)]
struct EgressProxyRoute {
    upstream_base_url: String,
    host: String,
    path_prefixes: Vec<String>,
    methods: Option<Vec<String>>,
    grant: String,
}

#[derive(Clone)]
struct EgressProxyState {
    tokenizer_proxy_egress_base_url: String,
    routes: Arc<Vec<EgressProxyRoute>>,
    client: Client<EgressConnector, HyperBody>,
    proxy_ca_certificate_pem: Arc<String>,
    proxy_ca_private_key_pem: Arc<String>,
    clock: Arc<dyn Clock>,
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
            Path::new(RUNTIME_PROXY_CA_CERT_PATH),
            clock,
            supervisor_handle,
        )
    }

    fn start_with_options(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        tokenizer_proxy_egress_base_url: &str,
        listener_address: SocketAddr,
        ca_certificate_path: &Path,
        clock: Arc<dyn Clock>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Option<Self>, EgressProxyError> {
        if runtime_plan.egress_routes.is_empty() {
            return Ok(None);
        }

        let routes = runtime_plan
            .egress_routes
            .iter()
            .map(|route| build_proxy_route(route, startup_input))
            .collect::<Result<Vec<_>, _>>()?;

        let proxy_directory = ca_certificate_path.parent().ok_or_else(|| {
            EgressProxyError::new("egress proxy CA path must include a parent directory")
        })?;
        prepare_proxy_directory(proxy_directory)?;
        let generated_proxy_ca = generate_proxy_ca(clock.as_ref())
            .map_err(|error| EgressProxyError::new(error.to_string()))?;
        fs::write(
            ca_certificate_path,
            generated_proxy_ca.certificate_pem.as_bytes(),
        )
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to write local egress proxy certificate '{}': {error}",
                ca_certificate_path.display()
            ))
        })?;

        let std_listener =
            bind_egress_proxy_listener(listener_address).map_err(EgressProxyError::new)?;
        let listener_address = std_listener.local_addr().map_err(|error| {
            EgressProxyError::new(format!(
                "failed to inspect local egress proxy address: {error}"
            ))
        })?;
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
        let https_connector = HttpsConnectorBuilder::new()
            .with_native_roots()
            .map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to load system certificate roots for local egress proxy: {error}"
                ))
            })?
            .https_or_http()
            .enable_http1()
            .wrap_connector(http_connector);
        let state = EgressProxyState {
            tokenizer_proxy_egress_base_url: tokenizer_proxy_egress_base_url.to_string(),
            routes: Arc::new(routes),
            client: Client::builder(TokioExecutor::new()).build(https_connector),
            proxy_ca_certificate_pem: Arc::new(generated_proxy_ca.certificate_pem.clone()),
            proxy_ca_private_key_pem: Arc::new(generated_proxy_ca.private_key_pem),
            clock,
        };

        let runtime_env = build_managed_proxy_env(
            listener_address,
            ca_certificate_path,
            tokenizer_proxy_egress_base_url,
        )?;

        supervisor_handle.mark_component_starting(SupervisedComponent::EgressProxy);
        let mut active_server = spawn_active_egress_proxy_server(std_listener, state.clone());
        if let Err(error) = wait_for_egress_proxy_health(
            listener_address,
            &mut active_server,
            EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
        ) {
            active_server.request_shutdown();
            let _ = active_server.join();
            return Err(error);
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
            ca_certificate_path: ca_certificate_path.to_path_buf(),
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
        let supervisor_command_sender = self.supervisor_command_sender.as_ref().ok_or_else(|| {
            EgressProxyError::new(
                "egress proxy fault injection is unavailable in this build or runtime mode",
            )
        })?;
        supervisor_command_sender
            .send(EgressProxySupervisorCommand::ForceCurrentServerShutdown)
            .map_err(|_| {
                EgressProxyError::new(
                    "egress proxy supervisor command channel is unavailable",
                )
            })
    }

    pub fn close(mut self) -> Result<(), EgressProxyError> {
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

        match fs::remove_file(&self.ca_certificate_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(EgressProxyError::new(format!(
                    "failed to remove local egress proxy certificate '{}': {error}",
                    self.ca_certificate_path.display()
                )));
            }
        }

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
                Err(error) if shutdown_requested.load(Ordering::Relaxed) => return Ok(()),
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
                Err(error) if shutdown_requested.load(Ordering::Relaxed) => return Ok(()),
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
        .body(Full::new(Bytes::new()))
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
    let request_body = body
        .collect()
        .await
        .map_err(|error| {
            EgressProxyError::new(format!("failed to read proxied request body: {error}"))
        })?
        .to_bytes();

    let mut outbound_request = Request::builder().method(request_method).uri(match route {
        Some(_) => build_tokenizer_proxy_forward_uri(
            &state.tokenizer_proxy_egress_base_url,
            request_path_and_query,
        )?,
        None => request_target.uri.clone(),
    });
    for (header_name, header_value) in filter_outbound_request_headers(&parts.headers) {
        outbound_request = outbound_request.header(header_name, header_value);
    }
    let outbound_request = match route {
        Some(route) => outbound_request
            .header(
                TOKENIZER_PROXY_EGRESS_GRANT_HEADER_NAME,
                route.grant.as_str(),
            )
            .body(Full::new(request_body))
            .map_err(|error| {
                EgressProxyError::new(format!("failed to build proxied request: {error}"))
            })?,
        None => outbound_request
            .body(Full::new(request_body))
            .map_err(|error| {
                EgressProxyError::new(format!("failed to build direct proxied request: {error}"))
            })?,
    };

    let upstream_response = state
        .client
        .request(outbound_request)
        .await
        .map_err(|error| match route {
            Some(route) => EgressProxyError::new(format!(
                "failed to forward request for '{}' through tokenizer-proxy route '{}': {error}",
                route.host, route.upstream_base_url
            )),
            None => EgressProxyError::new(format!(
                "failed to forward proxied request directly to '{}': {error}",
                request_target.authority
            )),
        })?;

    let (parts, body) = upstream_response.into_parts();
    let response_body = body
        .collect()
        .await
        .map_err(|error| {
            EgressProxyError::new(format!("failed to read proxied response body: {error}"))
        })?
        .to_bytes();
    let mut response_builder = Response::builder().status(parts.status);
    for (header_name, header_value) in filter_outbound_response_headers(&parts.headers) {
        response_builder = response_builder.header(header_name, header_value);
    }

    response_builder
        .body(Full::new(response_body))
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

fn text_response(status: StatusCode, message: impl Into<String>) -> Response<HyperBody> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Full::new(Bytes::from(message.into())))
        .expect("text response should build")
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::net::{SocketAddr, TcpListener as StdTcpListener};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use crate::egress_proxy::{
        EgressProxy, EgressProxyRoute, build_direct_forward_uri, build_managed_proxy_env,
        join_url_path, match_route,
    };
    use crate::protocol::startup::{StartupInput, StartupMode};
    use crate::runtime::{
        CompiledEgressRoute, CompiledEgressRouteAuthInjection,
        CompiledEgressRouteAuthInjectionType, CompiledEgressRouteCredentialResolver,
        CompiledEgressRouteMatch, CompiledEgressRouteUpstream, CompiledRuntimePlan,
    };
    use crate::supervision::{ComponentHealthState, SandboxdSupervisorHandle, SupervisedComponent};
    use crate::time::SystemClock;

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
                upstream_base_url: "https://api.github.com".to_string(),
                host: "api.github.com".to_string(),
                path_prefixes: vec!["/graphql".to_string()],
                methods: Some(vec!["POST".to_string()]),
                grant: "grant-a".to_string(),
            },
            EgressProxyRoute {
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
    fn keeps_a_stable_proxy_address_across_close_and_restart() {
        let listener_address = reserve_test_listener_address();
        let ca_certificate_path = test_ca_certificate_path();
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
            &ca_certificate_path,
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
            &ca_certificate_path,
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
        let _ = std::fs::remove_dir_all(
            ca_certificate_path
                .parent()
                .expect("test CA path should have a parent directory"),
        );
    }

    #[test]
    fn restarts_the_proxy_after_the_live_server_exits() {
        let listener_address = reserve_test_listener_address();
        let ca_certificate_path = test_ca_certificate_path();
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
            &ca_certificate_path,
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
        let _ = std::fs::remove_dir_all(
            ca_certificate_path
                .parent()
                .expect("test CA path should have a parent directory"),
        );
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
                credential_resolver: CompiledEgressRouteCredentialResolver {
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
            bootstrap_token: "bootstrap-token".to_string(),
            tunnel_exchange_token: "exchange-token".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:4500/tunnel/sandbox/sandbox-123".to_string(),
            runtime_plan: serde_json::json!({}),
            egress_grant_by_rule_id: BTreeMap::from([(
                "egress-rule-1".to_string(),
                "grant-1".to_string(),
            )]),
        }
    }

    fn test_ca_certificate_path() -> PathBuf {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("mistle-egress-proxy-test-{unique_id}"))
            .join("egress-proxy-ca.pem")
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
}
