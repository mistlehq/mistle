//! Rust decode types for the runtime-plan subset `sandboxd` currently applies.
//!
//! This module mirrors the shared runtime-plan wire shape closely enough for the
//! supervisor to materialize artifacts, workspace sources, setup files, and
//! runtime client processes without pulling in TypeScript-specific helpers.

use std::collections::BTreeMap;

use serde::Deserialize;

/// The subset of the compiled runtime plan that `sandboxd` currently understands.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledRuntimePlan {
    pub egress_routes: Vec<CompiledEgressRoute>,
    pub artifacts: Vec<CompiledRuntimeArtifact>,
    pub workspace_sources: Vec<CompiledWorkspaceSource>,
    pub runtime_clients: Vec<RuntimeClient>,
    pub agent_runtimes: Vec<CompiledAgentRuntime>,
}

/// One outbound route that the sandbox runtime may mediate through tokenizer-proxy.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRoute {
    pub egress_rule_id: String,
    pub binding_id: String,
    pub r#match: CompiledEgressRouteMatch,
    pub upstream: CompiledEgressRouteUpstream,
    pub auth_injection: CompiledEgressRouteAuthInjection,
    pub credential_resolver: CompiledEgressRouteCredentialResolver,
}

/// The request match constraints that select one egress route.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRouteMatch {
    pub hosts: Vec<String>,
    pub path_prefixes: Option<Vec<String>>,
    pub methods: Option<Vec<String>>,
}

/// The upstream origin for one mediated egress route.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRouteUpstream {
    pub base_url: String,
}

/// The auth-injection policy that tokenizer-proxy applies for one egress route.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRouteAuthInjection {
    pub r#type: CompiledEgressRouteAuthInjectionType,
    pub target: String,
    pub username: Option<String>,
}

/// The auth-injection strategies the runtime plan can request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum CompiledEgressRouteAuthInjectionType {
    #[serde(rename = "bearer")]
    Bearer,
    #[serde(rename = "basic")]
    Basic,
    #[serde(rename = "header")]
    Header,
    #[serde(rename = "query")]
    Query,
}

/// The credential source that backs one mediated egress route.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRouteCredentialResolver {
    pub connection_id: String,
    pub secret_type: String,
    pub purpose: Option<String>,
    pub resolver_key: Option<String>,
}

/// One artifact lifecycle command or runtime client process command.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeArtifactCommand {
    pub args: Vec<String>,
    pub env: Option<BTreeMap<String, String>>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
}

/// The install lifecycle for one compiled runtime artifact.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeArtifactLifecycle {
    pub install: Vec<RuntimeArtifactCommand>,
}

/// One artifact that must be materialized before runtime clients start.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledRuntimeArtifact {
    pub artifact_key: String,
    pub name: String,
    pub env: Option<BTreeMap<String, String>>,
    pub lifecycle: RuntimeArtifactLifecycle,
}

/// One file that runtime setup should write into the sandbox filesystem.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClientSetupFile {
    pub file_id: String,
    pub path: String,
    pub mode: u32,
    pub content: String,
    pub write_mode: Option<RuntimeFileWriteMode>,
}

/// The file-write behaviors `sandboxd` supports during runtime setup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeFileWriteMode {
    #[serde(rename = "overwrite")]
    Overwrite,
    #[serde(rename = "if-absent")]
    IfAbsent,
}

/// Shared setup state applied before a runtime client's processes start.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClientSetup {
    pub env: BTreeMap<String, String>,
    pub files: Vec<RuntimeClientSetupFile>,
    pub launch_args: Option<Vec<String>>,
}

/// One compiled runtime client definition from the runtime plan.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClient {
    pub client_id: String,
    pub setup: RuntimeClientSetup,
    pub processes: Vec<RuntimeClientProcess>,
    pub endpoints: Vec<RuntimeClientEndpoint>,
}

/// One child process that belongs to a runtime client.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClientProcess {
    pub process_key: String,
    pub command: RuntimeArtifactCommand,
    pub readiness: RuntimeClientProcessReadiness,
    pub stop: RuntimeClientProcessStopPolicy,
}

/// One client-visible endpoint exposed by a runtime client process.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClientEndpoint {
    pub endpoint_key: String,
    pub process_key: Option<String>,
    pub transport: RuntimeClientEndpointTransport,
    pub connection_mode: RuntimeClientConnectionMode,
}

/// The transports `sandboxd` currently understands for runtime client endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type")]
pub enum RuntimeClientEndpointTransport {
    #[serde(rename = "ws")]
    Ws { url: String },
}

/// The connection sharing modes supported by the runtime endpoint contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum RuntimeClientConnectionMode {
    #[serde(rename = "dedicated")]
    Dedicated,
    #[serde(rename = "shared")]
    Shared,
}

/// The readiness strategies supported for runtime client processes.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type")]
pub enum RuntimeClientProcessReadiness {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "tcp")]
    Tcp {
        host: String,
        port: u16,
        #[serde(rename = "timeoutMs")]
        timeout_ms: u64,
    },
    #[serde(rename = "http")]
    Http {
        url: String,
        #[serde(rename = "expectedStatus")]
        expected_status: u16,
        #[serde(rename = "timeoutMs")]
        timeout_ms: u64,
    },
    #[serde(rename = "ws")]
    Ws {
        url: String,
        #[serde(rename = "timeoutMs")]
        timeout_ms: u64,
    },
}

/// The configured stop behavior for one runtime client process.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClientProcessStopPolicy {
    pub signal: RuntimeClientProcessStopSignal,
    pub timeout_ms: u64,
    pub grace_period_ms: Option<u64>,
}

/// The Unix signals `sandboxd` can use when stopping runtime client processes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum RuntimeClientProcessStopSignal {
    #[serde(rename = "sigterm")]
    Sigterm,
    #[serde(rename = "sigkill")]
    Sigkill,
}

/// One compiled first-class agent runtime attached to the runtime plan.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledAgentRuntime {
    pub binding_id: String,
    pub runtime_id: String,
    pub runtime_key: String,
    pub client_id: String,
    pub endpoint_key: String,
    pub pty_launch: serde_json::Value,
}

/// The workspace sources `sandboxd` knows how to materialize today.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "sourceKind")]
pub enum CompiledWorkspaceSource {
    #[serde(rename = "git-clone")]
    GitClone {
        #[serde(rename = "resourceKind")]
        resource_kind: WorkspaceSourceResourceKind,
        path: String,
        #[serde(rename = "originUrl")]
        origin_url: String,
        #[serde(default)]
        clone_url: Option<String>,
        #[serde(default)]
        egress_grant_token: Option<String>,
    },
}

/// The resource categories that can currently back a workspace source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum WorkspaceSourceResourceKind {
    #[serde(rename = "repository")]
    Repository,
}
