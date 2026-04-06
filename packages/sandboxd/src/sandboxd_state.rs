//! Live initialized runtime state owned by the running `sandboxd` daemon.
//!
//! Once the daemon accepts `init`, it needs to own the runtime resources for
//! that sandbox session in one place: runtime-plan materialization, runtime
//! client processes, runtime-specific adapters, and the live bootstrap tunnel
//! session that publishes keepalive and serves tunnel streams.

use std::fmt;
use std::sync::{Arc, Mutex};

use crate::keepalive::KeepaliveManager;
use crate::process;
use crate::protocol::startup::StartupInput;
use crate::runtime;
use crate::runtime::adapters::{RuntimeAdapterRegistry, RuntimeAdapters};
use crate::time::{Clock, Sleeper};
use crate::tunnel::connect_bootstrap_tunnel;
use crate::tunnel::session::TunnelSession;

/// Describes why the initialized daemon runtime failed to start or stop.
#[derive(Debug)]
pub enum SandboxdStateError {
    ApplyRuntimePlan(String),
    StartRuntimeProcesses(String),
    StartRuntimeAdapters(String),
    ConnectBootstrapTunnel(String),
    StartTunnelSession(String),
    StopRuntimeProcesses(String),
    StopRuntimeAdapters(String),
    CloseTunnelSession(String),
}

impl fmt::Display for SandboxdStateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ApplyRuntimePlan(error) => write!(f, "failed to apply startup input: {error}"),
            Self::StartRuntimeProcesses(error) => {
                write!(f, "failed to start runtime client processes: {error}")
            }
            Self::StartRuntimeAdapters(error) => {
                write!(f, "failed to start runtime adapters: {error}")
            }
            Self::ConnectBootstrapTunnel(error) => {
                write!(f, "failed to connect bootstrap tunnel: {error}")
            }
            Self::StartTunnelSession(error) => {
                write!(f, "failed to start bootstrap tunnel session: {error}")
            }
            Self::StopRuntimeProcesses(error) => {
                write!(f, "failed to stop runtime client processes: {error}")
            }
            Self::StopRuntimeAdapters(error) => {
                write!(f, "failed to stop runtime adapters: {error}")
            }
            Self::CloseTunnelSession(error) => {
                write!(f, "failed to close bootstrap tunnel session: {error}")
            }
        }
    }
}

impl std::error::Error for SandboxdStateError {}

/// Owns the initialized sandbox runtime resources for one daemon process.
pub struct SandboxdState {
    process_manager: Option<process::RuntimeClientProcessManager>,
    runtime_adapters: RuntimeAdapters,
    tunnel_session: Option<TunnelSession>,
}

impl SandboxdState {
    /// Initializes the sandbox runtime from one accepted startup input.
    pub fn initialize(
        startup_input: &StartupInput,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
    ) -> Result<Self, SandboxdStateError> {
        runtime::apply_runtime_plan(startup_input)
            .map_err(|error| SandboxdStateError::ApplyRuntimePlan(error.to_string()))?;
        let runtime_plan: runtime::CompiledRuntimePlan =
            serde_json::from_value(startup_input.runtime_plan.clone())
                .map_err(|error| SandboxdStateError::ApplyRuntimePlan(error.to_string()))?;
        let process_specs =
            process::flatten_runtime_client_processes(&runtime_plan.runtime_clients);
        let process_manager = if process_specs.is_empty() {
            None
        } else {
            Some(
                process::start_runtime_client_process_manager(
                    &process_specs,
                    clock.as_ref(),
                    sleeper.as_ref(),
                )
                .map_err(|error| SandboxdStateError::StartRuntimeProcesses(error.to_string()))?,
            )
        };

        let keepalive_manager = Arc::new(Mutex::new(KeepaliveManager::default()));
        let runtime_adapters = RuntimeAdapterRegistry
            .start(startup_input, keepalive_manager.clone(), sleeper.clone())
            .map_err(|error| SandboxdStateError::StartRuntimeAdapters(error.to_string()))?;
        let agent_endpoint_url = match runtime_adapters.adapters() {
            [] => None,
            [adapter] => Some(adapter.listen_url().to_string()),
            _ => {
                return Err(SandboxdStateError::StartTunnelSession(
                    "sandboxd currently supports exactly one runtime adapter endpoint".to_string(),
                ));
            }
        };

        let tunnel = connect_bootstrap_tunnel(
            &startup_input.tunnel_gateway_ws_url,
            &startup_input.bootstrap_token,
        )
        .map_err(|error| SandboxdStateError::ConnectBootstrapTunnel(error.to_string()))?;
        let tunnel_session = Some(
            TunnelSession::start(
                startup_input,
                tunnel,
                keepalive_manager,
                agent_endpoint_url,
                clock,
                sleeper,
            )
            .map_err(|error| SandboxdStateError::StartTunnelSession(error.to_string()))?,
        );

        Ok(Self {
            process_manager,
            runtime_adapters,
            tunnel_session,
        })
    }

    /// Stops the initialized runtime resources owned by the daemon.
    pub fn close(mut self) -> Result<(), SandboxdStateError> {
        self.tunnel_session
            .take()
            .map(TunnelSession::close)
            .transpose()
            .map_err(|error| SandboxdStateError::CloseTunnelSession(error.to_string()))?;
        self.runtime_adapters
            .close()
            .map_err(|error| SandboxdStateError::StopRuntimeAdapters(error.to_string()))?;
        self.process_manager
            .take()
            .map(|process_manager| {
                process_manager.stop(&crate::time::SystemClock, &crate::time::ThreadSleeper)
            })
            .transpose()
            .map_err(|error| SandboxdStateError::StopRuntimeProcesses(error.to_string()))?;

        Ok(())
    }
}
