//! Sandbox-local egress proxy for runtime tools and interactive shells.
//!
//! Runtime tools like `gh` and `git` expect standard `HTTP[S]_PROXY` semantics,
//! while Mistle keeps credential-bearing egress decisions in the data-plane
//! gateway. This module exposes one local forward proxy inside the sandbox,
//! terminates proxied HTTPS sessions with a per-sandbox CA, matches each
//! decrypted request against the compiled runtime-plan egress routes, and
//! forwards the request through the data-plane gateway's direct egress routes.

use std::collections::BTreeMap;
use std::fmt::{self, Display};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(any(test, debug_assertions))]
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::Value;

use crate::egress_proxy::ca::{
    ProxyCaConfig, ProxyCaInstallation, cleanup_proxy_ca_installation, emit_proxy_ca_lifecycle_log,
    load_or_create_persistent_proxy_ca,
};
use crate::egress_proxy::env::{MANAGED_PROXY_ENV_KEYS, build_managed_proxy_env};
#[cfg(test)]
use crate::egress_proxy::gateway::DirectGatewayEgressTokenProvider;
use crate::egress_proxy::gateway::{DirectGatewayEgressClient, EgressProxyForwardingMode};
#[cfg(test)]
use crate::egress_proxy::gateway::{DirectGatewayRouteScheme, resolve_direct_gateway_route_url};
#[cfg(test)]
use crate::egress_proxy::logging::serialize_egress_proxy_log_line;
use crate::egress_proxy::logging::{EgressProxyLogContext, emit_egress_proxy_log};
use crate::egress_proxy::routing::{EgressProxyRoute, build_gateway_egress_route};
#[cfg(test)]
use crate::egress_proxy::routing::{
    RequestTargetOverride, build_direct_forward_uri, match_route, resolve_request_target,
};
#[cfg(test)]
use crate::egress_proxy::server::run_proxy_server;
use crate::egress_proxy::server::run_transparent_proxy_server;
#[cfg(test)]
use crate::egress_proxy::server::{
    TransparentProxyProtocol, classify_transparent_proxy_first_byte,
    filter_direct_gateway_request_headers,
};
use crate::egress_proxy::supervisor::EgressProxyProcessSupervisorConfig;
#[cfg(any(test, debug_assertions))]
use crate::egress_proxy::supervisor::EgressProxySupervisorCommand;
use crate::egress_proxy::supervisor::{
    ActiveEgressProxyChildProcess, ActiveEgressProxyServer, bind_transparent_egress_proxy_listener,
    run_egress_proxy_process_supervisor, spawn_active_egress_proxy_child_process,
    spawn_active_egress_proxy_server, wait_for_egress_proxy_child_health,
    wait_for_egress_proxy_health,
};
#[cfg(test)]
use crate::egress_proxy::supervisor::{
    EgressProxySupervisorConfig, bind_egress_proxy_listener, run_egress_proxy_supervisor,
};
#[cfg(test)]
use crate::egress_proxy::tls::websocket_target_url;
use crate::egress_proxy::transparent::TransparentPacketRules;
#[cfg(all(test, target_os = "linux"))]
use crate::egress_proxy::transparent::socket_addr_from_sockaddr_storage;
#[cfg(all(test, target_os = "linux"))]
use crate::egress_proxy::transparent::start_transparent_local_destination_reconciler_for_table;
#[cfg(test)]
use crate::egress_proxy::transparent::{
    build_nftables_install_commands, build_nftables_local_destination_set_replace_script,
    build_nftables_rule_plan_with_local_destinations, parse_iproute2_link_scope_ipv4_route_cidrs,
};
use crate::protocol::startup::StartupInput;
use crate::runtime::CompiledRuntimePlan;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, SystemClock};
use crate::tunnel::session::GatewayEgressTokenProvider;

const RUNTIME_PROXY_CA_CERT_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca.pem";
const RUNTIME_PROXY_CA_BUNDLE_PATH: &str = "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem";
const PERSISTENT_PROXY_CA_CERT_PATH: &str = "/var/lib/mistle/sandboxd/egress-proxy-ca.pem";
const PERSISTENT_PROXY_CA_KEY_PATH: &str = "/var/lib/mistle/sandboxd/egress-proxy-ca-key.pem";
const RUNTIME_PROXY_CA_TRUST_STORE_PATH: &str =
    "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt";
const SYSTEM_CA_CERT_BUNDLE_PATH: &str = "/etc/ssl/certs/ca-certificates.crt";
const UPDATE_CA_CERTIFICATES_COMMAND: &str = "update-ca-certificates";
#[cfg(all(debug_assertions, not(test)))]
const EGRESS_PROXY_CHILD_BINARY_PATH_ENV: &str = "MISTLE_SANDBOXD_EGRESS_PROXY_CHILD_PATH";
const DEFAULT_LOOPBACK_PROXY_PORT: u16 = 38_513;
const DEFAULT_TRANSPARENT_PROXY_PORT: u16 = 38_514;
#[cfg(target_os = "linux")]
const TRANSPARENT_PASSTHROUGH_SOCKET_MARK: u32 = 38_514;
const TRANSPARENT_NFTABLES_TABLE_NAME: &str = "mistle_transparent_egress";
const STATIC_LOCAL_DESTINATION_IPV4_CIDRS: [&str; 2] = ["127.0.0.0/8", "169.254.0.0/16"];
pub(super) const EGRESS_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(250);
pub(super) const EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(5);
pub(super) const EGRESS_PROXY_RESTART_BACKOFF_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 5000];
pub(super) const SANDBOX_EGRESS_REQUEST_ID_HEADER_NAME: &str = "x-mistle-sandbox-egress-id";
pub(super) const DIRECT_GATEWAY_EGRESS_AUTHORIZATION_HEADER_NAME: &str = "x-mistle-egress-token";
pub(super) const DIRECT_EGRESS_HTTP_ROUTE_PATH: &str = "/_mistle/egress/http";
pub(super) const DIRECT_EGRESS_WEBSOCKET_ROUTE_PATH: &str = "/_mistle/egress/ws";

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
#[cfg_attr(test, allow(dead_code))]
enum EgressProxyLoopbackRuntime {
    #[cfg(test)]
    InProcess,
    ChildProcess {
        binary_path: PathBuf,
        tunnel_gateway_ws_url: String,
        token_provider: GatewayEgressTokenProvider,
    },
}

enum ActiveLoopbackEgressProxy {
    #[cfg(test)]
    InProcess(ActiveEgressProxyServer),
    ChildProcess(ActiveEgressProxyChildProcess),
}

struct EgressProxyStartOptions<'a> {
    loopback_runtime: EgressProxyLoopbackRuntime,
    listener_address: SocketAddr,
    proxy_ca_config: ProxyCaConfig<'a>,
    clock: Arc<dyn Clock>,
    supervisor_handle: SandboxdSupervisorHandle,
}

#[derive(Clone)]
pub(super) struct EgressProxyState {
    sandbox_instance_id: String,
    forwarding_mode: EgressProxyForwardingMode,
    routes: Arc<RwLock<Vec<EgressProxyRoute>>>,
    pub(super) proxy_ca_certificate_pem: Arc<String>,
    pub(super) proxy_ca_private_key_pem: Arc<String>,
    pub(super) clock: Arc<dyn Clock>,
    next_request_id: Arc<AtomicU64>,
}

impl EgressProxyError {
    pub(super) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

pub fn run_egress_proxy_child(config_path: &Path) -> Result<(), EgressProxyError> {
    child::run_egress_proxy_child(config_path)
}

#[cfg(not(test))]
fn resolve_egress_proxy_child_binary_path() -> Result<PathBuf, EgressProxyError> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os(EGRESS_PROXY_CHILD_BINARY_PATH_ENV) {
        if path.as_os_str().is_empty() {
            return Err(EgressProxyError::new(format!(
                "{EGRESS_PROXY_CHILD_BINARY_PATH_ENV} cannot be empty"
            )));
        }
        return Ok(PathBuf::from(path));
    }

    std::env::current_exe().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to resolve sandboxd binary for egress proxy child: {error}"
        ))
    })
}

impl Display for EgressProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EgressProxyError {}

impl ActiveLoopbackEgressProxy {
    fn child_pid(&self) -> Option<u32> {
        match self {
            #[cfg(test)]
            Self::InProcess(_) => None,
            Self::ChildProcess(active_child) => Some(active_child.pid()),
        }
    }

    fn shutdown(self) -> Result<(), EgressProxyError> {
        match self {
            #[cfg(test)]
            Self::InProcess(mut active_server) => {
                active_server.request_shutdown();
                active_server.join()
            }
            Self::ChildProcess(active_child) => active_child.shutdown(),
        }
    }
}

fn egress_proxy_component_details(
    listener_address: SocketAddr,
    loopback_runtime: &EgressProxyLoopbackRuntime,
    child_pid: Option<u32>,
) -> BTreeMap<String, String> {
    let mut details = BTreeMap::from([
        ("listenAddr".to_string(), listener_address.to_string()),
        (
            "stablePort".to_string(),
            listener_address.port().to_string(),
        ),
    ]);
    match loopback_runtime {
        #[cfg(test)]
        EgressProxyLoopbackRuntime::InProcess => {
            details.insert("runtimeMode".to_string(), "in_process".to_string());
        }
        EgressProxyLoopbackRuntime::ChildProcess { binary_path, .. } => {
            details.insert("runtimeMode".to_string(), "child_process".to_string());
            details.insert("childBinary".to_string(), binary_path.display().to_string());
            if let Some(child_pid) = child_pid {
                details.insert("childPid".to_string(), child_pid.to_string());
            }
        }
    }
    details
}

fn start_active_loopback_proxy(
    loopback_runtime: &EgressProxyLoopbackRuntime,
    listener_address: SocketAddr,
    state: EgressProxyState,
    sandbox_instance_id: &str,
) -> Result<ActiveLoopbackEgressProxy, EgressProxyError> {
    match loopback_runtime {
        #[cfg(test)]
        EgressProxyLoopbackRuntime::InProcess => {
            let std_listener =
                bind_egress_proxy_listener(listener_address).map_err(EgressProxyError::new)?;
            Ok(ActiveLoopbackEgressProxy::InProcess(
                spawn_active_egress_proxy_server(std_listener, state, run_proxy_server),
            ))
        }
        EgressProxyLoopbackRuntime::ChildProcess {
            binary_path,
            tunnel_gateway_ws_url,
            token_provider,
        } => {
            let config = EgressProxyProcessSupervisorConfig {
                child_binary_path: binary_path.clone(),
                listener_address,
                sandbox_instance_id: sandbox_instance_id.to_string(),
                tunnel_gateway_ws_url: tunnel_gateway_ws_url.clone(),
                token_provider: token_provider.clone(),
                state,
            };
            spawn_active_egress_proxy_child_process(&config)
                .map(ActiveLoopbackEgressProxy::ChildProcess)
        }
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
                token_provider.clone(),
            )?),
        };
        #[cfg(test)]
        let loopback_runtime = EgressProxyLoopbackRuntime::InProcess;
        #[cfg(not(test))]
        let loopback_runtime = EgressProxyLoopbackRuntime::ChildProcess {
            binary_path: resolve_egress_proxy_child_binary_path()?,
            tunnel_gateway_ws_url: startup_input.tunnel_gateway_ws_url.clone(),
            token_provider,
        };
        Self::start_with_loopback_runtime(
            runtime_plan,
            startup_input,
            forwarding_mode,
            EgressProxyStartOptions {
                loopback_runtime,
                listener_address: default_loopback_proxy_listener_address(),
                proxy_ca_config: ProxyCaConfig {
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
            },
        )
    }

    #[cfg(test)]
    fn start_with_options(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        forwarding_mode: EgressProxyForwardingMode,
        listener_address: SocketAddr,
        proxy_ca_config: ProxyCaConfig<'_>,
        clock: Arc<dyn Clock>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Option<Self>, EgressProxyError> {
        Self::start_with_loopback_runtime(
            runtime_plan,
            startup_input,
            forwarding_mode,
            EgressProxyStartOptions {
                loopback_runtime: EgressProxyLoopbackRuntime::InProcess,
                listener_address,
                proxy_ca_config,
                clock,
                supervisor_handle,
            },
        )
    }

    fn start_with_loopback_runtime(
        runtime_plan: &CompiledRuntimePlan,
        startup_input: &StartupInput,
        forwarding_mode: EgressProxyForwardingMode,
        options: EgressProxyStartOptions<'_>,
    ) -> Result<Option<Self>, EgressProxyError> {
        if runtime_plan.egress_routes.is_empty() && startup_input.transparent_proxy.is_none() {
            return Ok(None);
        }
        let EgressProxyStartOptions {
            loopback_runtime,
            listener_address,
            proxy_ca_config,
            clock,
            supervisor_handle,
        } = options;
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

        if matches!(
            loopback_runtime,
            EgressProxyLoopbackRuntime::ChildProcess { .. }
        ) && listener_address.port() == 0
        {
            let cleanup_suffix = cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                .err()
                .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                .unwrap_or_default();
            return Err(EgressProxyError::new(format!(
                "egress proxy child process requires a stable listener port{cleanup_suffix}"
            )));
        }
        supervisor_handle.replace_component_details(
            SupervisedComponent::EgressProxy,
            egress_proxy_component_details(listener_address, &loopback_runtime, None),
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
        let active_loopback = match start_active_loopback_proxy(
            &loopback_runtime,
            listener_address,
            state.clone(),
            supervisor_handle.sandbox_instance_id(),
        ) {
            Ok(mut active_loopback) => {
                let health_result = match &mut active_loopback {
                    #[cfg(test)]
                    ActiveLoopbackEgressProxy::InProcess(active_server) => {
                        wait_for_egress_proxy_health(
                            listener_address,
                            active_server,
                            EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
                        )
                    }
                    ActiveLoopbackEgressProxy::ChildProcess(active_child) => {
                        wait_for_egress_proxy_child_health(
                            listener_address,
                            active_child,
                            EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
                        )
                    }
                };
                if let Err(error) = health_result {
                    let _ = active_loopback.shutdown();
                    let cleanup_suffix =
                        cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                            .err()
                            .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                            .unwrap_or_default();
                    return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
                }
                supervisor_handle.replace_component_details(
                    SupervisedComponent::EgressProxy,
                    egress_proxy_component_details(
                        listener_address,
                        &loopback_runtime,
                        active_loopback.child_pid(),
                    ),
                );
                active_loopback
            }
            Err(error) => {
                let cleanup_suffix =
                    cleanup_proxy_ca_installation(&proxy_ca_installation, log_context)
                        .err()
                        .map(|cleanup_error| format!(" cleanup also failed: {cleanup_error}"))
                        .unwrap_or_default();
                return Err(EgressProxyError::new(format!("{error}{cleanup_suffix}")));
            }
        };
        supervisor_handle.mark_component_healthy(SupervisedComponent::EgressProxy);

        let mut transparent_server = match transparent_listener_address {
            Some(transparent_listener_address) => {
                let transparent_listener =
                    match bind_transparent_egress_proxy_listener(transparent_listener_address) {
                        Ok(transparent_listener) => transparent_listener,
                        Err(error) => {
                            let _ = active_loopback.shutdown();
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
                        let _ = active_loopback.shutdown();
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
                    let _ = active_loopback.shutdown();
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
                        log_context,
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
                            let _ = active_loopback.shutdown();
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
        #[cfg(any(test, debug_assertions))]
        let supervisor_command_sender_for_proxy = Some(supervisor_command_sender);
        let supervisor_thread = thread::spawn({
            let shutdown_requested = shutdown_requested.clone();
            let supervisor_handle = supervisor_handle.clone();
            move || match (loopback_runtime, active_loopback) {
                #[cfg(test)]
                (
                    EgressProxyLoopbackRuntime::InProcess,
                    ActiveLoopbackEgressProxy::InProcess(active_server),
                ) => {
                    let config = EgressProxySupervisorConfig {
                        listener_address,
                        state,
                    };
                    run_egress_proxy_supervisor(
                        config,
                        active_server,
                        shutdown_requested,
                        supervisor_handle,
                        #[cfg(any(test, debug_assertions))]
                        supervisor_command_receiver,
                    )
                }
                (
                    EgressProxyLoopbackRuntime::ChildProcess {
                        binary_path,
                        tunnel_gateway_ws_url,
                        token_provider,
                    },
                    ActiveLoopbackEgressProxy::ChildProcess(active_child),
                ) => {
                    let config = EgressProxyProcessSupervisorConfig {
                        child_binary_path: binary_path,
                        listener_address,
                        sandbox_instance_id: supervisor_handle.sandbox_instance_id().to_string(),
                        tunnel_gateway_ws_url,
                        token_provider,
                        state,
                    };
                    run_egress_proxy_process_supervisor(
                        config,
                        active_child,
                        shutdown_requested,
                        supervisor_handle,
                        #[cfg(any(test, debug_assertions))]
                        supervisor_command_receiver,
                    )
                }
                #[cfg(test)]
                _ => Err(EgressProxyError::new(
                    "egress proxy loopback runtime changed during startup",
                )),
            }
        });

        Ok(Some(Self {
            runtime_env,
            shutdown_requested,
            supervisor_thread: Some(supervisor_thread),
            transparent_server,
            #[cfg(any(test, debug_assertions))]
            supervisor_command_sender: supervisor_command_sender_for_proxy,
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

#[cfg(test)]
mod tests;

mod body;
mod ca;
mod child;
mod env;
mod gateway;
mod logging;
mod routing;
mod server;
mod supervisor;
mod tls;
mod token_bridge;
mod transparent;
