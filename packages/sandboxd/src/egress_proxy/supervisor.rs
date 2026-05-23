//! Thread supervisor for the sandbox-local egress proxy.
//!
//! The supervisor owns listener binding, runtime threads, readiness projection,
//! shutdown signaling, and health snapshots for the managed forward-proxy
//! listener. Transparent-proxy startup health is handled by the outer proxy
//! module.

use std::io::{self, Write};
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::sync::oneshot;

use crate::egress_proxy::routing::EgressProxyRoute;
#[cfg(test)]
use crate::egress_proxy::run_proxy_server;
use crate::egress_proxy::token_bridge::{EgressTokenBridgeServer, create_token_bridge_pair};
use crate::egress_proxy::{
    EGRESS_PROXY_HEALTHCHECK_INTERVAL, EGRESS_PROXY_RESTART_BACKOFF_MS,
    EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT, EgressProxyError, EgressProxyState,
};
use crate::proxy_ca::{GeneratedProxyCa, prepare_proxy_ca_runtime};
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::tunnel::session::GatewayEgressTokenProvider;

#[cfg(test)]
pub(super) struct EgressProxySupervisorConfig {
    pub(super) listener_address: SocketAddr,
    pub(super) state: EgressProxyState,
}

pub(super) struct EgressProxyProcessSupervisorConfig {
    pub(super) child_binary_path: PathBuf,
    pub(super) listener_address: SocketAddr,
    pub(super) sandbox_instance_id: String,
    pub(super) tunnel_gateway_ws_url: String,
    pub(super) token_provider: GatewayEgressTokenProvider,
    pub(super) state: EgressProxyState,
}

#[cfg(any(test, debug_assertions))]
pub(super) enum EgressProxySupervisorCommand {
    ForceCurrentServerShutdown,
}

#[derive(Debug)]
pub(super) struct ActiveEgressProxyServer {
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
    exit_receiver: mpsc::Receiver<Result<(), EgressProxyError>>,
}

pub(super) struct ActiveEgressProxyChildProcess {
    child: Child,
    token_bridge: Option<EgressTokenBridgeServer>,
    config_file: tempfile::NamedTempFile,
}

pub(super) fn spawn_active_egress_proxy_server(
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
    pub(super) fn request_shutdown(&mut self) {
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

    pub(super) fn join(mut self) -> Result<(), EgressProxyError> {
        if let Some(server_thread) = self.server_thread.take() {
            return match server_thread.join() {
                Ok(result) => result,
                Err(_) => Err(EgressProxyError::new("local egress proxy thread panicked")),
            };
        }
        Ok(())
    }

    #[cfg(test)]
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

impl ActiveEgressProxyChildProcess {
    pub(super) fn request_shutdown(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.child.kill();
        }
    }

    fn try_recv_exit(&mut self) -> Result<Option<Result<(), EgressProxyError>>, EgressProxyError> {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                self.close_token_bridge()?;
                if status.success() {
                    return Ok(Some(Ok(())));
                }
                Ok(Some(Err(EgressProxyError::new(format!(
                    "local egress proxy child exited with {status}"
                )))))
            }
            Ok(None) => Ok(None),
            Err(error) => Err(EgressProxyError::new(format!(
                "failed to poll local egress proxy child: {error}"
            ))),
        }
    }

    pub(super) fn join(mut self) -> Result<(), EgressProxyError> {
        let _config_path = self.config_file.path();
        let status = self.child.wait().map_err(|error| {
            EgressProxyError::new(format!(
                "failed to wait for local egress proxy child: {error}"
            ))
        })?;
        if let Some(token_bridge) = self.token_bridge.take() {
            token_bridge.close()?;
        }
        if status.success() {
            return Ok(());
        }
        Err(EgressProxyError::new(format!(
            "local egress proxy child exited with {status}"
        )))
    }

    pub(super) fn join_after_requested_shutdown(mut self) -> Result<(), EgressProxyError> {
        let _config_path = self.config_file.path();
        self.child.wait().map_err(|error| {
            EgressProxyError::new(format!(
                "failed to wait for local egress proxy child after shutdown: {error}"
            ))
        })?;
        self.close_token_bridge()
    }

    fn close_token_bridge(&mut self) -> Result<(), EgressProxyError> {
        if let Some(token_bridge) = self.token_bridge.take() {
            token_bridge.close()?;
        }
        Ok(())
    }
}

pub(super) fn spawn_active_egress_proxy_child_process(
    config: &EgressProxyProcessSupervisorConfig,
) -> Result<ActiveEgressProxyChildProcess, EgressProxyError> {
    let (parent_token_stream, child_token_stream) = create_token_bridge_pair()?;
    set_close_on_exec_before_spawn(child_token_stream.as_raw_fd())?;
    let prepared_proxy_ca = prepare_proxy_ca_runtime(&GeneratedProxyCa {
        certificate_pem: config.state.proxy_ca_certificate_pem.as_ref().clone(),
        private_key_pem: config.state.proxy_ca_private_key_pem.as_ref().clone(),
    })
    .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let proxy_ca_certificate_fd = prepared_proxy_ca
        .certificate_fd()
        .map_err(|error| EgressProxyError::new(error.to_string()))?;
    let proxy_ca_private_key_fd = prepared_proxy_ca
        .private_key_fd()
        .map_err(|error| EgressProxyError::new(error.to_string()))?;

    let routes = config
        .state
        .routes
        .read()
        .map_err(|_| EgressProxyError::new("egress proxy route table lock is poisoned"))?
        .clone();
    let mut config_file = tempfile::Builder::new()
        .prefix("mistle-egress-proxy-child-")
        .suffix(".json")
        .tempfile()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to create egress proxy child config: {error}"
            ))
        })?;
    serde_json::to_writer(
        &mut config_file,
        &serde_json::json!({
            "sandboxInstanceId": config.sandbox_instance_id,
            "listenAddr": config.listener_address.to_string(),
            "tunnelGatewayWsUrl": config.tunnel_gateway_ws_url,
            "tokenBridgeFd": child_token_stream.as_raw_fd(),
            "routes": serialize_child_routes(&routes),
            "proxyCaCertificateFd": proxy_ca_certificate_fd,
            "proxyCaPrivateKeyFd": proxy_ca_private_key_fd
        }),
    )
    .map_err(|error| {
        EgressProxyError::new(format!(
            "failed to write egress proxy child config: {error}"
        ))
    })?;
    config_file.flush().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to flush egress proxy child config: {error}"
        ))
    })?;

    let child_inherited_fds = [
        child_token_stream.as_raw_fd(),
        proxy_ca_certificate_fd,
        proxy_ca_private_key_fd,
    ];
    let token_bridge =
        EgressTokenBridgeServer::start(parent_token_stream, config.token_provider.clone())?;
    let mut child_command = Command::new(&config.child_binary_path);
    child_command
        .arg("egress-proxy")
        .arg("--config")
        .arg(config_file.path())
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    unsafe {
        child_command.pre_exec(move || {
            for fd in child_inherited_fds {
                clear_close_on_exec_before_child_exec(fd)?;
            }
            Ok(())
        });
    }
    let child = child_command.spawn().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to spawn local egress proxy child '{}': {error}",
            config.child_binary_path.display()
        ))
    })?;
    drop(child_token_stream);
    drop(prepared_proxy_ca);

    Ok(ActiveEgressProxyChildProcess {
        child,
        token_bridge: Some(token_bridge),
        config_file,
    })
}

fn serialize_child_routes(routes: &[EgressProxyRoute]) -> Vec<serde_json::Value> {
    routes
        .iter()
        .map(|route| {
            serde_json::json!({
                "egressRuleId": route.egress_rule_id,
                "hosts": route.hosts,
                "pathPrefixes": route.path_prefixes,
                "methods": route.methods,
            })
        })
        .collect()
}

fn set_close_on_exec_before_spawn(fd: RawFd) -> Result<(), EgressProxyError> {
    update_close_on_exec(fd, true).map_err(|error| {
        EgressProxyError::new(format!("failed to set close-on-exec for fd {fd}: {error}"))
    })
}

fn clear_close_on_exec_before_child_exec(fd: RawFd) -> io::Result<()> {
    update_close_on_exec(fd, false)
}

fn update_close_on_exec(fd: RawFd, close_on_exec: bool) -> io::Result<()> {
    if fd < 0 {
        return Err(io::Error::from_raw_os_error(nix::libc::EINVAL));
    }

    let current_flags = unsafe { nix::libc::fcntl(fd, nix::libc::F_GETFD) };
    if current_flags < 0 {
        return Err(io::Error::last_os_error());
    }

    let updated_flags = if close_on_exec {
        current_flags | nix::libc::FD_CLOEXEC
    } else {
        current_flags & !nix::libc::FD_CLOEXEC
    };
    if unsafe { nix::libc::fcntl(fd, nix::libc::F_SETFD, updated_flags) } < 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(test)]
pub(super) fn run_egress_proxy_supervisor(
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

pub(super) fn run_egress_proxy_process_supervisor(
    config: EgressProxyProcessSupervisorConfig,
    mut active_child: ActiveEgressProxyChildProcess,
    shutdown_requested: Arc<AtomicBool>,
    supervisor_handle: SandboxdSupervisorHandle,
    #[cfg(any(test, debug_assertions))] supervisor_command_receiver: mpsc::Receiver<
        EgressProxySupervisorCommand,
    >,
) -> Result<(), EgressProxyError> {
    let mut restart_attempt_index = 0_usize;

    loop {
        if shutdown_requested.load(Ordering::Relaxed) {
            active_child.request_shutdown();
            return active_child.join_after_requested_shutdown();
        }

        #[cfg(any(test, debug_assertions))]
        match supervisor_command_receiver.try_recv() {
            Ok(EgressProxySupervisorCommand::ForceCurrentServerShutdown) => {
                active_child.request_shutdown();
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {}
        }

        let exit_result = active_child.try_recv_exit()?;
        if let Some(exit_result) = exit_result {
            let exit_error = normalize_egress_proxy_exit_result(exit_result);
            record_egress_proxy_process_exit_for_restart(&supervisor_handle, &exit_error);
            active_child = match restart_egress_proxy_process_after_backoff(
                &config,
                shutdown_requested.as_ref(),
                &supervisor_handle,
                &mut restart_attempt_index,
            ) {
                Ok(active_child) => active_child,
                Err(_) if shutdown_requested.load(Ordering::Relaxed) => return Ok(()),
                Err(error) => return Err(error),
            };
            continue;
        }

        if let Err(error) = check_egress_proxy_health(config.listener_address) {
            record_egress_proxy_healthcheck_failure(&supervisor_handle, &error);
            active_child.request_shutdown();
            let _ = active_child.join_after_requested_shutdown();
            active_child = match restart_egress_proxy_process_after_backoff(
                &config,
                shutdown_requested.as_ref(),
                &supervisor_handle,
                &mut restart_attempt_index,
            ) {
                Ok(active_child) => active_child,
                Err(_) if shutdown_requested.load(Ordering::Relaxed) => return Ok(()),
                Err(error) => return Err(error),
            };
            continue;
        }

        supervisor_handle.record_component_healthcheck(SupervisedComponent::EgressProxy);
        thread::sleep(EGRESS_PROXY_HEALTHCHECK_INTERVAL);
    }
}

fn restart_egress_proxy_process_after_backoff(
    config: &EgressProxyProcessSupervisorConfig,
    shutdown_requested: &AtomicBool,
    supervisor_handle: &SandboxdSupervisorHandle,
    restart_attempt_index: &mut usize,
) -> Result<ActiveEgressProxyChildProcess, EgressProxyError> {
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
        let mut active_child = match spawn_active_egress_proxy_child_process(config) {
            Ok(active_child) => active_child,
            Err(error) => {
                record_egress_proxy_healthcheck_failure(supervisor_handle, &error);
                *restart_attempt_index = restart_attempt_index.saturating_add(1);
                continue;
            }
        };
        match wait_for_egress_proxy_child_health(
            config.listener_address,
            &mut active_child,
            EGRESS_PROXY_STARTUP_HEALTHCHECK_TIMEOUT,
        ) {
            Ok(()) => {
                supervisor_handle.mark_component_healthy(SupervisedComponent::EgressProxy);
                *restart_attempt_index = restart_attempt_index.saturating_add(1);
                return Ok(active_child);
            }
            Err(error) => {
                record_egress_proxy_healthcheck_failure(supervisor_handle, &error);
                active_child.request_shutdown();
                let _ = active_child.join_after_requested_shutdown();
                *restart_attempt_index = restart_attempt_index.saturating_add(1);
            }
        }
    }
}

pub(super) fn wait_for_egress_proxy_child_health(
    listener_address: SocketAddr,
    active_child: &mut ActiveEgressProxyChildProcess,
    timeout: Duration,
) -> Result<(), EgressProxyError> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(exit_result) = active_child.try_recv_exit()? {
            return match exit_result {
                Ok(()) => Err(EgressProxyError::new(
                    "local egress proxy child returned before becoming healthy",
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

#[cfg(test)]
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

pub(super) fn wait_for_egress_proxy_health(
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

#[cfg(test)]
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

fn record_egress_proxy_process_exit_for_restart(
    supervisor_handle: &SandboxdSupervisorHandle,
    error: &EgressProxyError,
) {
    let error_text = error.to_string();
    supervisor_handle
        .mark_component_restarting(SupervisedComponent::EgressProxy, error_text.clone());
    supervisor_handle.emit_component_exited(
        SupervisedComponent::EgressProxy,
        "process_exited",
        Some(&error_text),
        &[("exitKind", Value::String("process_exited".to_string()))],
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

pub(super) fn bind_egress_proxy_listener(
    listener_address: SocketAddr,
) -> Result<StdTcpListener, String> {
    let std_listener = StdTcpListener::bind(listener_address)
        .map_err(|error| format!("failed to bind local egress proxy listener: {error}"))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|error| format!("failed to configure proxy listener: {error}"))?;
    Ok(std_listener)
}

pub(super) fn bind_transparent_egress_proxy_listener(
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
