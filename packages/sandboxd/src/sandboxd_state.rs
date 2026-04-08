//! Live initialized runtime state owned by the running `sandboxd` daemon.
//!
//! Once the daemon accepts `init`, it needs to own the runtime resources for
//! that sandbox session in one place: runtime-plan materialization, runtime
//! client processes, runtime-specific adapters, and the live bootstrap tunnel
//! session that publishes keepalive and serves tunnel streams.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use url::Url;

use crate::egress_proxy::EgressProxy;
use crate::keepalive::KeepaliveManager;
use crate::process;
use crate::protocol::startup::StartupInput;
use crate::runtime;
use crate::runtime::adapters::{RuntimeAdapterRegistry, RuntimeAdapters};
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::time::{Clock, Sleeper};
use crate::tunnel::session::TunnelSession;

/// Describes why the initialized daemon runtime failed to start or stop.
#[derive(Debug)]
pub enum SandboxdStateError {
    ApplyRuntimePlan(String),
    StartEgressProxy(String),
    StartRuntimeProcesses(String),
    StartRuntimeAdapters(String),
    StartTunnelSession(String),
    StopEgressProxy(String),
    StopRuntimeProcesses(String),
    StopRuntimeAdapters(String),
    CloseTunnelSession(String),
}

impl fmt::Display for SandboxdStateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ApplyRuntimePlan(error) => write!(f, "failed to apply startup input: {error}"),
            Self::StartEgressProxy(error) => {
                write!(f, "failed to start local egress proxy: {error}")
            }
            Self::StartRuntimeProcesses(error) => {
                write!(f, "failed to start runtime client processes: {error}")
            }
            Self::StartRuntimeAdapters(error) => {
                write!(f, "failed to start runtime adapters: {error}")
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
            Self::StopEgressProxy(error) => {
                write!(f, "failed to stop local egress proxy: {error}")
            }
        }
    }
}

impl std::error::Error for SandboxdStateError {}

const TOKENIZER_PROXY_EGRESS_BASE_URL_ENV: &str = "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";

/// Owns the initialized sandbox runtime resources for one daemon process.
pub struct SandboxdState {
    egress_proxy: Option<EgressProxy>,
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
        let mut runtime_plan: runtime::CompiledRuntimePlan =
            serde_json::from_value(startup_input.runtime_plan.clone())
                .map_err(|error| SandboxdStateError::ApplyRuntimePlan(error.to_string()))?;
        let tokenizer_proxy_egress_base_url = resolve_tokenizer_proxy_egress_base_url()?;
        apply_runtime_startup_overrides(
            &mut runtime_plan,
            startup_input,
            &tokenizer_proxy_egress_base_url,
        )?;
        runtime::apply_compiled_runtime_plan(&runtime_plan)
            .map_err(|error| SandboxdStateError::ApplyRuntimePlan(error.to_string()))?;
        let egress_proxy = EgressProxy::start(
            &runtime_plan,
            startup_input,
            &tokenizer_proxy_egress_base_url,
            clock.clone(),
        )
        .map_err(|error| SandboxdStateError::StartEgressProxy(error.to_string()))?;
        let runtime_env = collect_runtime_environment(&runtime_plan)
            .map_err(SandboxdStateError::StartRuntimeProcesses)?;
        let runtime_env = merge_managed_runtime_environment(
            runtime_env,
            egress_proxy.as_ref().map(EgressProxy::runtime_env),
        )
        .map_err(SandboxdStateError::StartRuntimeProcesses)?;
        let process_specs =
            process::flatten_runtime_client_processes(&runtime_plan.runtime_clients, &runtime_env);
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
        let runtime_readiness_manager = Arc::new(Mutex::new(RuntimeReadinessManager::default()));
        let runtime_adapters = RuntimeAdapterRegistry
            .start(
                startup_input,
                keepalive_manager.clone(),
                runtime_readiness_manager.clone(),
                sleeper.clone(),
            )
            .map_err(|error| SandboxdStateError::StartRuntimeAdapters(error.to_string()))?;
        let agent_endpoint_url = match runtime_adapters.adapters() {
            [] => {
                runtime_readiness_manager
                    .lock()
                    .expect("runtime readiness manager lock should not be poisoned")
                    .set_ready(true);
                None
            }
            [adapter] => Some(adapter.listen_url().to_string()),
            _ => {
                return Err(SandboxdStateError::StartTunnelSession(
                    "sandboxd currently supports exactly one runtime adapter endpoint".to_string(),
                ));
            }
        };

        let tunnel_session = Some(
            TunnelSession::start(
                startup_input,
                keepalive_manager,
                runtime_readiness_manager,
                agent_endpoint_url,
                runtime_env,
                clock,
                sleeper,
            )
            .map_err(|error| SandboxdStateError::StartTunnelSession(error.to_string()))?,
        );

        Ok(Self {
            egress_proxy,
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
        self.egress_proxy
            .take()
            .map(EgressProxy::close)
            .transpose()
            .map_err(|error| SandboxdStateError::StopEgressProxy(error.to_string()))?;

        Ok(())
    }
}

fn resolve_tokenizer_proxy_egress_base_url() -> Result<String, SandboxdStateError> {
    std::env::var(TOKENIZER_PROXY_EGRESS_BASE_URL_ENV).map_err(|_| {
        SandboxdStateError::StartRuntimeProcesses(format!(
            "required sandbox env '{TOKENIZER_PROXY_EGRESS_BASE_URL_ENV}' is missing"
        ))
    })
}

fn collect_runtime_environment(
    runtime_plan: &runtime::CompiledRuntimePlan,
) -> Result<BTreeMap<String, String>, String> {
    let mut runtime_env = BTreeMap::new();

    for artifact in &runtime_plan.artifacts {
        let Some(artifact_env) = &artifact.env else {
            continue;
        };

        for (name, value) in artifact_env {
            match runtime_env.get(name) {
                Some(existing_value) if existing_value != value => {
                    return Err(format!(
                        "runtime plan artifacts define conflicting values for env '{name}'"
                    ));
                }
                Some(_) => {}
                None => {
                    runtime_env.insert(name.clone(), value.clone());
                }
            }
        }
    }

    Ok(runtime_env)
}

fn merge_managed_runtime_environment(
    mut runtime_env: BTreeMap<String, String>,
    managed_env: Option<&BTreeMap<String, String>>,
) -> Result<BTreeMap<String, String>, String> {
    let Some(managed_env) = managed_env else {
        return Ok(runtime_env);
    };

    for (name, value) in managed_env {
        match runtime_env.get(name) {
            Some(existing_value) if existing_value != value => {
                return Err(format!(
                    "runtime plan artifacts define managed env '{name}', which sandboxd reserves"
                ));
            }
            Some(_) => {}
            None => {
                runtime_env.insert(name.clone(), value.clone());
            }
        }
    }

    Ok(runtime_env)
}

fn apply_runtime_startup_overrides(
    runtime_plan: &mut runtime::CompiledRuntimePlan,
    startup_input: &StartupInput,
    tokenizer_proxy_egress_base_url: &str,
) -> Result<(), SandboxdStateError> {
    for workspace_source in &mut runtime_plan.workspace_sources {
        apply_workspace_source_startup_overrides(
            workspace_source,
            &runtime_plan.egress_routes,
            &startup_input.egress_grant_by_rule_id,
            tokenizer_proxy_egress_base_url,
        )?;
    }

    Ok(())
}

fn apply_workspace_source_startup_overrides(
    workspace_source: &mut runtime::CompiledWorkspaceSource,
    egress_routes: &[runtime::CompiledEgressRoute],
    egress_grant_by_rule_id: &std::collections::BTreeMap<String, String>,
    tokenizer_proxy_egress_base_url: &str,
) -> Result<(), SandboxdStateError> {
    match workspace_source {
        runtime::CompiledWorkspaceSource::GitClone {
            path,
            origin_url,
            clone_url,
            egress_grant_token,
            ..
        } => {
            let route = resolve_workspace_source_egress_route(origin_url, egress_routes).ok_or_else(
                || {
                    SandboxdStateError::StartRuntimeProcesses(format!(
                        "workspace source '{path}' must resolve exactly one egress route for '{origin_url}'"
                    ))
                },
            )?;
            let egress_grant = egress_grant_by_rule_id
                .get(&route.egress_rule_id)
                .ok_or_else(|| {
                    SandboxdStateError::StartRuntimeProcesses(format!(
                        "missing egress grant for route '{}'",
                        route.egress_rule_id
                    ))
                })?;
            *clone_url = Some(
                resolve_tokenizer_proxy_forward_url(tokenizer_proxy_egress_base_url, origin_url)
                    .map_err(SandboxdStateError::StartRuntimeProcesses)?,
            );
            *egress_grant_token = Some(egress_grant.clone());
        }
    }

    Ok(())
}

fn resolve_tokenizer_proxy_forward_url(
    tokenizer_proxy_egress_base_url: &str,
    forward_url: &str,
) -> Result<String, String> {
    let mut tokenizer_proxy_url = Url::parse(tokenizer_proxy_egress_base_url).map_err(|error| {
        format!(
            "sandbox tokenizer proxy egress base url '{tokenizer_proxy_egress_base_url}' is invalid: {error}"
        )
    })?;
    let forward_url = Url::parse(forward_url).map_err(|error| {
        format!("workspace source origin url '{forward_url}' is invalid: {error}")
    })?;

    tokenizer_proxy_url.set_path(&join_url_path(
        tokenizer_proxy_url.path(),
        forward_url.path(),
    ));
    tokenizer_proxy_url.set_query(forward_url.query());
    tokenizer_proxy_url.set_fragment(None);

    Ok(tokenizer_proxy_url.to_string())
}

fn resolve_workspace_source_egress_route<'a>(
    origin_url: &str,
    egress_routes: &'a [runtime::CompiledEgressRoute],
) -> Option<&'a runtime::CompiledEgressRoute> {
    let origin_url = Url::parse(origin_url).ok()?;
    let origin_host = origin_url.host_str()?;
    let origin_path = origin_url.path();
    let matching_routes = egress_routes
        .iter()
        .filter(|route| {
            route.r#match.hosts.iter().any(|host| host == origin_host)
                && route
                    .r#match
                    .path_prefixes
                    .as_ref()
                    .is_some_and(|path_prefixes| {
                        path_prefixes
                            .iter()
                            .any(|path_prefix| origin_path.starts_with(path_prefix))
                    })
        })
        .collect::<Vec<_>>();

    let [route] = matching_routes.as_slice() else {
        return None;
    };

    Some(*route)
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::protocol::startup::{StartupInput, StartupMode};
    use crate::runtime::{
        CompiledRuntimePlan, RuntimeClient, RuntimeClientEndpoint, RuntimeClientEndpointTransport,
        RuntimeClientProcess, RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy,
        RuntimeClientProcessStopSignal, RuntimeClientSetup, RuntimeClientSetupFile,
    };
    use crate::sandboxd_state::{apply_runtime_startup_overrides, collect_runtime_environment};

    #[test]
    fn preserves_codex_runtime_client_config_while_rewriting_workspace_sources() {
        let mut runtime_plan = CompiledRuntimePlan {
            egress_routes: vec![
                crate::runtime::CompiledEgressRoute {
                    egress_rule_id: "egress_rule_bind_openai_agent".to_string(),
                    binding_id: "bind_openai_agent".to_string(),
                    r#match: crate::runtime::CompiledEgressRouteMatch {
                        hosts: vec!["api.openai.com".to_string()],
                        path_prefixes: Some(vec!["/v1/responses".to_string()]),
                        methods: Some(vec!["POST".to_string()]),
                    },
                    upstream: crate::runtime::CompiledEgressRouteUpstream {
                        base_url: "https://api.openai.com/v1".to_string(),
                    },
                    auth_injection: crate::runtime::CompiledEgressRouteAuthInjection {
                        r#type: crate::runtime::CompiledEgressRouteAuthInjectionType::Bearer,
                        target: "authorization".to_string(),
                        username: None,
                    },
                    credential_resolver: crate::runtime::CompiledEgressRouteCredentialResolver {
                        connection_id: "icn_test".to_string(),
                        secret_type: "api_key".to_string(),
                        slot_key: None,
                        resolver_key: None,
                    },
                },
                crate::runtime::CompiledEgressRoute {
                    egress_rule_id: "egress_rule_bind_github".to_string(),
                    binding_id: "bind_github".to_string(),
                    r#match: crate::runtime::CompiledEgressRouteMatch {
                        hosts: vec!["github.com".to_string()],
                        path_prefixes: Some(vec!["/mistlehq/private-repo.git".to_string()]),
                        methods: Some(vec!["GET".to_string(), "POST".to_string()]),
                    },
                    upstream: crate::runtime::CompiledEgressRouteUpstream {
                        base_url: "https://github.com".to_string(),
                    },
                    auth_injection: crate::runtime::CompiledEgressRouteAuthInjection {
                        r#type: crate::runtime::CompiledEgressRouteAuthInjectionType::Basic,
                        target: "authorization".to_string(),
                        username: Some("x-access-token".to_string()),
                    },
                    credential_resolver: crate::runtime::CompiledEgressRouteCredentialResolver {
                        connection_id: "icn_github".to_string(),
                        secret_type: "github_app_installation_token".to_string(),
                        slot_key: None,
                        resolver_key: Some("github_app_installation_token".to_string()),
                    },
                },
            ],
            artifacts: Vec::new(),
            workspace_sources: vec![crate::runtime::CompiledWorkspaceSource::GitClone {
                resource_kind: crate::runtime::WorkspaceSourceResourceKind::Repository,
                path: "/workspace/mistlehq/private-repo".to_string(),
                origin_url: "https://github.com/mistlehq/private-repo.git".to_string(),
                clone_url: None,
                egress_grant_token: None,
            }],
            runtime_clients: vec![RuntimeClient {
                client_id: "codex-cli".to_string(),
                setup: RuntimeClientSetup {
                    env: BTreeMap::new(),
                    files: vec![RuntimeClientSetupFile {
                        file_id: "codex_config".to_string(),
                        path: "/etc/codex/config.toml".to_string(),
                        mode: 0o600,
                        content: r#"
model = "gpt-5.4-codex"
model_provider = "proxy"

[model_providers.proxy]
name = "Proxy"
base_url = "https://api.openai.com/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
"#
                        .trim()
                        .to_string(),
                        write_mode: None,
                    }],
                    launch_args: None,
                },
                processes: vec![RuntimeClientProcess {
                    process_key: "codex-app-server".to_string(),
                    command: crate::runtime::RuntimeArtifactCommand {
                        args: vec![
                            "/usr/local/bin/codex".to_string(),
                            "app-server".to_string(),
                            "--listen".to_string(),
                            "ws://127.0.0.1:4501".to_string(),
                        ],
                        env: None,
                        cwd: None,
                        timeout_ms: None,
                    },
                    readiness: RuntimeClientProcessReadiness::Ws {
                        url: "ws://127.0.0.1:4501".to_string(),
                        timeout_ms: 5_000,
                    },
                    stop: RuntimeClientProcessStopPolicy {
                        signal: RuntimeClientProcessStopSignal::Sigterm,
                        timeout_ms: 10_000,
                        grace_period_ms: Some(2_000),
                    },
                }],
                endpoints: vec![RuntimeClientEndpoint {
                    endpoint_key: "app-server".to_string(),
                    process_key: Some("codex-app-server".to_string()),
                    transport: RuntimeClientEndpointTransport::Ws {
                        url: "ws://127.0.0.1:4500".to_string(),
                    },
                    connection_mode: crate::runtime::RuntimeClientConnectionMode::Dedicated,
                }],
            }],
            agent_runtimes: vec![crate::runtime::CompiledAgentRuntime {
                binding_id: "bind_openai_agent".to_string(),
                runtime_id: "codex".to_string(),
                runtime_key: "codex-app-server".to_string(),
                client_id: "codex-cli".to_string(),
                endpoint_key: "app-server".to_string(),
                pty_launch: serde_json::json!({}),
            }],
        };
        let startup_input = StartupInput {
            startup_mode: StartupMode::New,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: "ws://127.0.0.1:5000/bootstrap".to_string(),
            runtime_plan: serde_json::json!({
                "egressRoutes": [
                    {
                        "egressRuleId": "egress_rule_bind_openai_agent",
                        "bindingId": "bind_openai_agent",
                        "upstream": {
                            "baseUrl": "https://api.openai.com/v1"
                        }
                    },
                    {
                        "egressRuleId": "egress_rule_bind_github",
                        "bindingId": "bind_github",
                        "upstream": {
                            "baseUrl": "https://github.com"
                        }
                    }
                ],
                "artifacts": [],
                "workspaceSources": [
                    {
                        "sourceKind": "git-clone",
                        "resourceKind": "repository",
                        "path": "/workspace/mistlehq/private-repo",
                        "originUrl": "https://github.com/mistlehq/private-repo.git"
                    }
                ],
                "runtimeClients": [
                    {
                        "clientId": "codex-cli",
                        "setup": {
                            "env": {},
                            "files": []
                        },
                        "processes": [
                            {
                                "processKey": "codex-app-server",
                                "command": {
                                    "args": [
                                        "/usr/local/bin/codex",
                                        "app-server",
                                        "--listen",
                                        "ws://127.0.0.1:4501"
                                    ]
                                },
                                "readiness": {
                                    "type": "ws",
                                    "url": "ws://127.0.0.1:4501",
                                    "timeoutMs": 5000
                                },
                                "stop": {
                                    "signal": "sigterm",
                                    "timeoutMs": 10000,
                                    "gracePeriodMs": 2000
                                }
                            }
                        ],
                        "endpoints": [
                            {
                                "endpointKey": "app-server",
                                "processKey": "codex-app-server",
                                "transport": {
                                    "type": "ws",
                                    "url": "ws://127.0.0.1:4500"
                                },
                                "connectionMode": "dedicated"
                            }
                        ]
                    }
                ],
                "agentRuntimes": [
                    {
                        "bindingId": "bind_openai_agent",
                        "runtimeId": "codex",
                        "runtimeKey": "codex-app-server",
                        "clientId": "codex-cli",
                        "endpointKey": "app-server",
                        "ptyLaunch": {}
                    }
                ]
            }),
            egress_grant_by_rule_id: BTreeMap::from([
                (
                    "egress_rule_bind_openai_agent".to_string(),
                    "signed-egress-grant".to_string(),
                ),
                (
                    "egress_rule_bind_github".to_string(),
                    "signed-github-egress-grant".to_string(),
                ),
            ]),
        };
        let original_config = runtime_plan
            .runtime_clients
            .first()
            .expect("runtime client should exist")
            .setup
            .files
            .first()
            .expect("codex config file should exist")
            .content
            .clone();

        apply_runtime_startup_overrides(
            &mut runtime_plan,
            &startup_input,
            "http://127.0.0.1:5205/tokenizer-proxy/egress",
        )
        .expect("workspace source startup overrides should apply");

        let runtime_client = runtime_plan
            .runtime_clients
            .first()
            .expect("runtime client should exist");
        let config = &runtime_client
            .setup
            .files
            .first()
            .expect("codex config file should exist")
            .content;
        assert_eq!(config, &original_config);
        let workspace_source = runtime_plan
            .workspace_sources
            .first()
            .expect("workspace source should exist");
        let (
            workspace_source_origin_url,
            workspace_source_clone_url,
            workspace_source_egress_grant_token,
        ) = match workspace_source {
            crate::runtime::CompiledWorkspaceSource::GitClone {
                origin_url,
                clone_url,
                egress_grant_token,
                ..
            } => (origin_url, clone_url, egress_grant_token),
        };
        assert_eq!(
            workspace_source_origin_url,
            "https://github.com/mistlehq/private-repo.git"
        );
        assert_eq!(
            workspace_source_clone_url,
            &Some(
                "http://127.0.0.1:5205/tokenizer-proxy/egress/mistlehq/private-repo.git"
                    .to_string()
            )
        );
        assert_eq!(
            workspace_source_egress_grant_token,
            &Some("signed-github-egress-grant".to_string())
        );
    }

    #[test]
    fn collects_runtime_environment_from_artifacts() {
        let runtime_plan = CompiledRuntimePlan {
            egress_routes: Vec::new(),
            artifacts: vec![
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "gh-cli".to_string(),
                    name: "GitHub CLI".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "token-value".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "jira-cli".to_string(),
                    name: "Jira CLI".to_string(),
                    env: Some(BTreeMap::from([(
                        "JIRA_BASE_URL".to_string(),
                        "https://mistle.atlassian.net".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
            ],
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        let runtime_env =
            collect_runtime_environment(&runtime_plan).expect("runtime env should collect");

        assert_eq!(
            runtime_env,
            BTreeMap::from([
                ("GH_TOKEN".to_string(), "token-value".to_string()),
                (
                    "JIRA_BASE_URL".to_string(),
                    "https://mistle.atlassian.net".to_string(),
                ),
            ])
        );
    }

    #[test]
    fn rejects_conflicting_runtime_environment_values() {
        let runtime_plan = CompiledRuntimePlan {
            egress_routes: Vec::new(),
            artifacts: vec![
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "artifact-a".to_string(),
                    name: "Artifact A".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "first".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
                crate::runtime::CompiledRuntimeArtifact {
                    artifact_key: "artifact-b".to_string(),
                    name: "Artifact B".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "second".to_string(),
                    )])),
                    lifecycle: crate::runtime::RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
            ],
            workspace_sources: Vec::new(),
            runtime_clients: Vec::new(),
            agent_runtimes: Vec::new(),
        };

        let error =
            collect_runtime_environment(&runtime_plan).expect_err("conflict should fail fast");
        assert_eq!(
            error,
            "runtime plan artifacts define conflicting values for env 'GH_TOKEN'"
        );
    }
}
