//! Runtime-specific platform-activity adapters for `sandboxd`.
//!
//! Some first-class agent runtimes hide meaningful work inside one long-lived
//! daemon process, so process supervision alone cannot tell `sandboxd` whether
//! that runtime should still keep the sandbox alive. This module owns the
//! registry that resolves compiled `agentRuntimes` entries into concrete
//! adapter instances and starts the ones `sandboxd` understands today.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::{Arc, Mutex};

use crate::codex_proxy::{
    CodexProxy, CodexProxyControlHandle, CodexProxyError, start_codex_proxy_with_supervisor,
};
use crate::keepalive::KeepaliveManager;
use crate::protocol::startup::StartupInput;
use crate::runtime::plan::{
    CompiledAgentRuntime, CompiledRuntimePlan, RuntimeClientConnectionMode,
    RuntimeClientEndpointTransport, RuntimeClientProcessReadiness,
};
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::SystemClock;
use crate::tunnel::session::derive_sandbox_instance_id;
/// Starts the runtime-specific platform-activity adapters declared by one startup input.
#[derive(Debug, Clone, Copy, Default)]
pub struct RuntimeAdapterRegistry;

/// Describes why one runtime adapter could not be resolved or started.
#[derive(Debug)]
pub enum RuntimeAdapterRegistryError {
    InvalidRuntimePlan(serde_json::Error),
    UnsupportedRuntimeId {
        runtime_id: String,
    },
    DuplicateRuntimeId {
        runtime_id: String,
    },
    MissingRuntimeClient {
        runtime_id: String,
        client_id: String,
    },
    MissingRuntimeEndpoint {
        runtime_id: String,
        client_id: String,
        endpoint_key: String,
    },
    MissingRuntimeProcess {
        runtime_id: String,
        client_id: String,
        process_key: String,
    },
    UnsupportedConnectionMode {
        runtime_id: String,
        connection_mode: RuntimeClientConnectionMode,
    },
    RawAppServerReadinessMustUseWebSocket {
        runtime_id: String,
        process_key: String,
    },
    StartCodexProxy(CodexProxyError),
}

impl fmt::Display for RuntimeAdapterRegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRuntimePlan(error) => write!(f, "runtime plan is invalid: {error}"),
            Self::UnsupportedRuntimeId { runtime_id } => {
                write!(
                    f,
                    "sandboxd has no platform-activity adapter for runtime '{runtime_id}'"
                )
            }
            Self::DuplicateRuntimeId { runtime_id } => write!(
                f,
                "runtime plan declared duplicate agent runtime id '{runtime_id}'"
            ),
            Self::MissingRuntimeClient {
                runtime_id,
                client_id,
            } => write!(
                f,
                "runtime '{runtime_id}' references missing runtime client '{client_id}'"
            ),
            Self::MissingRuntimeEndpoint {
                runtime_id,
                client_id,
                endpoint_key,
            } => write!(
                f,
                "runtime '{runtime_id}' references missing endpoint '{endpoint_key}' on runtime client '{client_id}'"
            ),
            Self::MissingRuntimeProcess {
                runtime_id,
                client_id,
                process_key,
            } => write!(
                f,
                "runtime '{runtime_id}' references missing process '{process_key}' on runtime client '{client_id}'"
            ),
            Self::UnsupportedConnectionMode {
                runtime_id,
                connection_mode,
            } => write!(
                f,
                "runtime '{runtime_id}' endpoint uses unsupported connection mode '{connection_mode:?}'"
            ),
            Self::RawAppServerReadinessMustUseWebSocket {
                runtime_id,
                process_key,
            } => write!(
                f,
                "runtime '{runtime_id}' process '{process_key}' must use websocket readiness so sandboxd can attach its proxy adapter"
            ),
            Self::StartCodexProxy(error) => {
                write!(f, "failed to start Codex runtime adapter: {error}")
            }
        }
    }
}

impl std::error::Error for RuntimeAdapterRegistryError {}

/// Owns one running runtime-specific adapter instance.
pub enum RuntimeAdapter {
    Codex {
        runtime_id: String,
        proxy: CodexProxy,
    },
}

impl RuntimeAdapter {
    /// Returns the runtime id this adapter instance belongs to.
    pub fn runtime_id(&self) -> &str {
        match self {
            Self::Codex { runtime_id, .. } => runtime_id,
        }
    }

    /// Returns the client-visible websocket URL when this adapter exposes one.
    pub fn listen_url(&self) -> &str {
        match self {
            Self::Codex { proxy, .. } => proxy.listen_url(),
        }
    }

    /// Stops the adapter and releases its background resources.
    pub fn close(self) -> Result<(), RuntimeAdapterRegistryError> {
        match self {
            Self::Codex { proxy, .. } => proxy.close().map_err(Self::map_codex_close_error),
        }
    }

    fn map_codex_close_error(error: CodexProxyError) -> RuntimeAdapterRegistryError {
        RuntimeAdapterRegistryError::StartCodexProxy(error)
    }
}

/// Groups the runtime adapters started for one accepted startup input.
#[derive(Default)]
pub struct RuntimeAdapters {
    adapters: Vec<RuntimeAdapter>,
    codex_proxy_control_handle: Option<CodexProxyControlHandle>,
}

impl RuntimeAdapters {
    /// Returns the started adapters in runtime-plan order.
    pub fn adapters(&self) -> &[RuntimeAdapter] {
        &self.adapters
    }

    pub fn codex_proxy_control_handle(&self) -> Option<&CodexProxyControlHandle> {
        self.codex_proxy_control_handle.as_ref()
    }

    /// Stops all started adapters and returns the first close error, if any.
    pub fn close(self) -> Result<(), RuntimeAdapterRegistryError> {
        for adapter in self.adapters {
            adapter.close()?;
        }

        Ok(())
    }
}

impl RuntimeAdapterRegistry {
    /// Starts all runtime-specific adapters declared by one startup input.
    pub fn start(
        &self,
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    ) -> Result<RuntimeAdapters, RuntimeAdapterRegistryError> {
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)
            .map_err(|error| {
                RuntimeAdapterRegistryError::StartCodexProxy(CodexProxyError::ConfigureRuntime(
                    error.to_string(),
                ))
            })?;
        let supervisor_handle = SandboxdSupervisorHandle::new(
            sandbox_instance_id,
            Arc::new(SystemClock),
            BTreeSet::from([SupervisedComponent::CodexProxy]),
        );

        self.start_with_supervisor(
            startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            supervisor_handle,
        )
    }

    /// Starts all runtime-specific adapters using the shared supervisor boundary.
    pub fn start_with_supervisor(
        &self,
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<RuntimeAdapters, RuntimeAdapterRegistryError> {
        let runtime_plan: CompiledRuntimePlan =
            serde_json::from_value(startup_input.runtime_plan.clone())
                .map_err(RuntimeAdapterRegistryError::InvalidRuntimePlan)?;

        let mut seen_runtime_ids = BTreeSet::new();
        let mut started_adapters = Vec::new();
        let mut codex_proxy_control_handle = None;
        for agent_runtime in &runtime_plan.agent_runtimes {
            if !seen_runtime_ids.insert(agent_runtime.runtime_id.clone()) {
                return Err(RuntimeAdapterRegistryError::DuplicateRuntimeId {
                    runtime_id: agent_runtime.runtime_id.clone(),
                });
            }

            match agent_runtime.runtime_id.as_str() {
                "codex" => {
                    let (adapter, control_handle) = start_codex_runtime_adapter(
                        agent_runtime,
                        &runtime_plan,
                        keepalive_manager.clone(),
                        runtime_readiness_manager.clone(),
                        supervisor_handle.clone(),
                    )?;
                    started_adapters.push(adapter);
                    codex_proxy_control_handle = Some(control_handle);
                }
                _ => {
                    return Err(RuntimeAdapterRegistryError::UnsupportedRuntimeId {
                        runtime_id: agent_runtime.runtime_id.clone(),
                    });
                }
            }
        }

        Ok(RuntimeAdapters {
            adapters: started_adapters,
            codex_proxy_control_handle,
        })
    }
}

fn start_codex_runtime_adapter(
    agent_runtime: &CompiledAgentRuntime,
    runtime_plan: &CompiledRuntimePlan,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
    supervisor_handle: SandboxdSupervisorHandle,
) -> Result<(RuntimeAdapter, CodexProxyControlHandle), RuntimeAdapterRegistryError> {
    let runtime_client = runtime_plan
        .runtime_clients
        .iter()
        .find(|runtime_client| runtime_client.client_id == agent_runtime.client_id)
        .ok_or_else(|| RuntimeAdapterRegistryError::MissingRuntimeClient {
            runtime_id: agent_runtime.runtime_id.clone(),
            client_id: agent_runtime.client_id.clone(),
        })?;

    let endpoint = runtime_client
        .endpoints
        .iter()
        .find(|endpoint| endpoint.endpoint_key == agent_runtime.endpoint_key)
        .ok_or_else(|| RuntimeAdapterRegistryError::MissingRuntimeEndpoint {
            runtime_id: agent_runtime.runtime_id.clone(),
            client_id: agent_runtime.client_id.clone(),
            endpoint_key: agent_runtime.endpoint_key.clone(),
        })?;
    if endpoint.connection_mode != RuntimeClientConnectionMode::Dedicated {
        return Err(RuntimeAdapterRegistryError::UnsupportedConnectionMode {
            runtime_id: agent_runtime.runtime_id.clone(),
            connection_mode: endpoint.connection_mode,
        });
    }

    let process = runtime_client
        .processes
        .iter()
        .find(|process| process.process_key == agent_runtime.runtime_key)
        .ok_or_else(|| RuntimeAdapterRegistryError::MissingRuntimeProcess {
            runtime_id: agent_runtime.runtime_id.clone(),
            client_id: agent_runtime.client_id.clone(),
            process_key: agent_runtime.runtime_key.clone(),
        })?;

    let RuntimeClientEndpointTransport::Ws { url: listen_url } = &endpoint.transport;
    let RuntimeClientProcessReadiness::Ws {
        url: raw_app_server_url,
        ..
    } = &process.readiness
    else {
        return Err(
            RuntimeAdapterRegistryError::RawAppServerReadinessMustUseWebSocket {
                runtime_id: agent_runtime.runtime_id.clone(),
                process_key: process.process_key.clone(),
            },
        );
    };

    let proxy = start_codex_proxy_with_supervisor(
        listen_url,
        raw_app_server_url,
        keepalive_manager,
        runtime_readiness_manager,
        supervisor_handle,
    )
    .map_err(RuntimeAdapterRegistryError::StartCodexProxy)?;
    let control_handle = proxy.control_handle();

    Ok((
        RuntimeAdapter::Codex {
            runtime_id: agent_runtime.runtime_id.clone(),
            proxy,
        },
        control_handle,
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};

    use crate::keepalive::KeepaliveManager;
    use crate::protocol::startup::{StartupInput, StartupMode};
    use crate::runtime::adapters::{RuntimeAdapterRegistry, RuntimeAdapterRegistryError};
    use crate::runtime::readiness::RuntimeReadinessManager;

    #[test]
    fn rejects_unknown_runtime_ids() {
        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:5000/tunnel/sandbox".to_string(),
            runtime_plan: serde_json::json!({
                "sandboxProfileId": "sbp_123",
                "version": 1,
                "image": {
                    "source": "base",
                    "imageRef": "mistle/sandbox-base:dev"
                },
                "egressRoutes": [],
                "artifacts": [],
                "runtimeClients": [],
                "workspaceSources": [],
                "agentRuntimes": [
                    {
                        "bindingId": "arb_123",
                        "runtimeId": "unknown-runtime",
                        "runtimeKey": "runtime-process",
                        "clientId": "runtime-client",
                        "endpointKey": "app-server",
                        "ptyLaunch": {}
                    }
                ]
            }),
            egress_grant_by_rule_id: BTreeMap::new(),
            git_identity: None,
        };

        match RuntimeAdapterRegistry.start(
            &startup_input,
            Arc::new(Mutex::new(KeepaliveManager::default())),
            Arc::new(Mutex::new(RuntimeReadinessManager::default())),
        ) {
            Ok(_) => panic!("unknown runtime ids should be rejected"),
            Err(error) => assert!(matches!(
                error,
                RuntimeAdapterRegistryError::UnsupportedRuntimeId { runtime_id }
                if runtime_id == "unknown-runtime"
            )),
        }
    }
}
