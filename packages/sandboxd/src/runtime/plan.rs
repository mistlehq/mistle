//! Rust decode types for the runtime-plan subset `sandboxd` currently applies.
//!
//! This module mirrors the shared runtime-plan wire shape closely enough for the
//! supervisor to materialize artifacts, workspace sources, setup files, and
//! runtime client processes without pulling in TypeScript-specific helpers.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer};

/// The subset of the compiled runtime plan that `sandboxd` currently understands.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledRuntimePlan {
    pub sandbox_profile_id: String,
    pub version: u32,
    pub image: CompiledRuntimePlanImage,
    pub setup_script: Option<String>,
    pub egress_routes: Vec<CompiledEgressRoute>,
    pub artifacts: Vec<CompiledRuntimeArtifact>,
    pub workspace_sources: Vec<CompiledWorkspaceSource>,
    #[serde(default)]
    pub skills: Option<CompiledRuntimePlanSkills>,
    pub runtime_clients: Vec<RuntimeClient>,
    pub agent_runtimes: Vec<CompiledAgentRuntime>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledRuntimePlanImage {
    pub source: CompiledRuntimePlanImageSource,
    pub image_ref: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompiledRuntimePlanImageSource {
    ProfileBase,
    Base,
    Snapshot,
}

/// One outbound route that the sandbox runtime may mediate through gateway egress.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRoute {
    pub egress_rule_id: String,
    pub binding_id: String,
    pub family_id: String,
    pub variant_id: String,
    pub r#match: CompiledEgressRouteMatch,
    pub upstream: CompiledEgressRouteUpstream,
    pub auth_injection: CompiledEgressRouteAuthInjection,
    pub additional_headers: Option<BTreeMap<String, String>>,
    pub additional_credential_headers: Option<Vec<CompiledEgressRouteCredentialHeaderInjection>>,
    pub credential_resolver: CompiledEgressRouteCredentialResolver,
    pub request_middleware: Option<Vec<String>>,
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

/// The auth-injection policy that gateway egress applies for one egress route.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRouteAuthInjection {
    pub r#type: CompiledEgressRouteAuthInjectionType,
    pub target: Option<String>,
    pub username: Option<String>,
    pub service: Option<String>,
    pub region: Option<String>,
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
    #[serde(rename = "aws_sigv4")]
    AwsSigv4,
}

/// One supplemental header whose value is injected from a credential resolver.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledEgressRouteCredentialHeaderInjection {
    pub header: String,
    pub credential_resolver: CompiledEgressRouteCredentialResolver,
}

/// The credential source that backs one mediated egress route.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CompiledEgressRouteCredentialResolver {
    IntegrationConnection {
        #[serde(rename = "connectionId")]
        connection_id: String,
        #[serde(rename = "secretType")]
        secret_type: String,
        #[serde(rename = "slotKey")]
        slot_key: Option<String>,
        #[serde(rename = "resolverKey")]
        resolver_key: Option<String>,
    },
    LinkedPrincipal {
        #[serde(rename = "providerFamily")]
        provider_family: String,
        #[serde(rename = "integrationConnectionId")]
        integration_connection_id: String,
        #[serde(rename = "credentialKind")]
        credential_kind: Option<String>,
        #[serde(rename = "actingUserRequired")]
        acting_user_required: bool,
        #[serde(rename = "resolutionMode")]
        resolution_mode: CompiledLinkedPrincipalEgressCredentialResolutionMode,
    },
    MistleMcpToken {
        #[serde(rename = "apiKeyId")]
        api_key_id: String,
    },
    MistleMcpSetupAssistantToken {
        #[serde(rename = "sandboxProfileId")]
        sandbox_profile_id: String,
        #[serde(rename = "sandboxProfileVersion")]
        sandbox_profile_version: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum CompiledLinkedPrincipalEgressCredentialResolutionMode {
    #[serde(rename = "required")]
    Required,
    #[serde(rename = "preferred")]
    Preferred,
}

/// One subprocess command used by runtime client processes and exec artifact installs.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeExecCommand {
    pub args: Vec<String>,
    pub env: Option<BTreeMap<String, String>>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
}

fn deserialize_non_empty_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if value.is_empty() {
        return Err(serde::de::Error::custom("string value must not be empty"));
    }
    Ok(value)
}

fn deserialize_non_empty_string_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = Vec::<String>::deserialize(deserializer)?;
    if values.is_empty() {
        return Err(serde::de::Error::custom("string list must not be empty"));
    }
    if values.iter().any(String::is_empty) {
        return Err(serde::de::Error::custom(
            "string list entries must not be empty",
        ));
    }
    Ok(values)
}

/// One GitHub release selector for a typed artifact install step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeArtifactGitHubReleaseSelector {
    Latest,
    Tag {
        selector: RuntimeArtifactGitHubReleaseTagSelector,
    },
}

impl<'de> Deserialize<'de> for RuntimeArtifactGitHubReleaseSelector {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
        enum Wire {
            Latest,
            Tag {
                #[serde(rename = "match")]
                match_kind: RuntimeArtifactGitHubReleaseTagSelectorMatchWire,
                tag: Option<String>,
                prefix: Option<String>,
            },
        }

        match Wire::deserialize(deserializer)? {
            Wire::Latest => Ok(Self::Latest),
            Wire::Tag {
                match_kind,
                tag,
                prefix,
            } => match match_kind {
                RuntimeArtifactGitHubReleaseTagSelectorMatchWire::Exact => {
                    let tag = parse_required_non_empty_string(tag, "tag")?;
                    if prefix.is_some() {
                        return Err(serde::de::Error::custom(
                            "exact github release selectors must not include prefix",
                        ));
                    }
                    Ok(Self::Tag {
                        selector: RuntimeArtifactGitHubReleaseTagSelector::Exact { tag },
                    })
                }
                RuntimeArtifactGitHubReleaseTagSelectorMatchWire::LatestMatchingPrefix => {
                    let prefix = parse_required_non_empty_string(prefix, "prefix")?;
                    if tag.is_some() {
                        return Err(serde::de::Error::custom(
                            "latest_matching_prefix github release selectors must not include tag",
                        ));
                    }
                    Ok(Self::Tag {
                        selector: RuntimeArtifactGitHubReleaseTagSelector::LatestMatchingPrefix {
                            prefix,
                        },
                    })
                }
            },
        }
    }
}

/// The tag-selection payload for typed GitHub release install steps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeArtifactGitHubReleaseTagSelector {
    Exact { tag: String },
    LatestMatchingPrefix { prefix: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeArtifactGitHubReleaseTagSelectorMatchWire {
    Exact,
    LatestMatchingPrefix,
}

/// One concrete GitHub release asset shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeArtifactGitHubReleaseAssetShape {
    Binary(RuntimeArtifactGitHubReleaseBinaryAssetShape),
    TarGz(RuntimeArtifactGitHubReleaseTarGzAssetShape),
}

impl<'de> Deserialize<'de> for RuntimeArtifactGitHubReleaseAssetShape {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Shape {
            #[serde(deserialize_with = "deserialize_non_empty_string")]
            file_name: String,
            format: RuntimeArtifactGitHubReleaseAssetFormatWire,
            extracted_path: Option<String>,
            sha256: Option<String>,
        }

        let shape = Shape::deserialize(deserializer)?;
        parse_github_release_asset_shape(
            shape.file_name,
            shape.format,
            shape.extracted_path,
            shape.sha256,
        )
    }
}

/// One binary GitHub release asset shape.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeArtifactGitHubReleaseBinaryAssetShape {
    #[serde(deserialize_with = "deserialize_non_empty_string")]
    pub file_name: String,
    pub format: RuntimeArtifactGitHubReleaseBinaryAssetFormat,
    #[serde(default)]
    pub sha256: Option<String>,
}

/// One tarball GitHub release asset shape.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeArtifactGitHubReleaseTarGzAssetShape {
    #[serde(deserialize_with = "deserialize_non_empty_string")]
    pub file_name: String,
    pub format: RuntimeArtifactGitHubReleaseTarGzAssetFormat,
    #[serde(deserialize_with = "deserialize_non_empty_string")]
    pub extracted_path: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

/// The supported binary GitHub release asset format marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum RuntimeArtifactGitHubReleaseBinaryAssetFormat {
    #[serde(rename = "binary")]
    Binary,
}

/// The supported tarball GitHub release asset format marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum RuntimeArtifactGitHubReleaseTarGzAssetFormat {
    #[serde(rename = "tar.gz")]
    TarGz,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
enum RuntimeArtifactGitHubReleaseAssetFormatWire {
    #[serde(rename = "binary")]
    Binary,
    #[serde(rename = "tar.gz")]
    TarGz,
}

/// The GitHub release asset selection for a typed install step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeArtifactGitHubReleaseInstallAsset {
    Exact(RuntimeArtifactGitHubReleaseAssetShape),
    ByArch {
        x86_64: RuntimeArtifactGitHubReleaseAssetShape,
        aarch64: RuntimeArtifactGitHubReleaseAssetShape,
    },
}

impl<'de> Deserialize<'de> for RuntimeArtifactGitHubReleaseInstallAsset {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
        enum Wire {
            #[serde(rename = "exact")]
            Exact {
                #[serde(rename = "fileName")]
                #[serde(deserialize_with = "deserialize_non_empty_string")]
                file_name: String,
                format: RuntimeArtifactGitHubReleaseAssetFormatWire,
                #[serde(rename = "extractedPath")]
                extracted_path: Option<String>,
                sha256: Option<String>,
            },
            #[serde(rename = "by_arch")]
            ByArch {
                #[serde(rename = "x86_64")]
                x86_64: RuntimeArtifactGitHubReleaseAssetShape,
                #[serde(rename = "aarch64")]
                aarch64: RuntimeArtifactGitHubReleaseAssetShape,
            },
        }

        match Wire::deserialize(deserializer)? {
            Wire::Exact {
                file_name,
                format,
                extracted_path,
                sha256,
            } => Ok(Self::Exact(parse_github_release_asset_shape(
                file_name,
                format,
                extracted_path,
                sha256,
            )?)),
            Wire::ByArch { x86_64, aarch64 } => Ok(Self::ByArch { x86_64, aarch64 }),
        }
    }
}

fn parse_github_release_asset_shape<E>(
    file_name: String,
    format: RuntimeArtifactGitHubReleaseAssetFormatWire,
    extracted_path: Option<String>,
    sha256: Option<String>,
) -> Result<RuntimeArtifactGitHubReleaseAssetShape, E>
where
    E: serde::de::Error,
{
    match (format, extracted_path) {
        (RuntimeArtifactGitHubReleaseAssetFormatWire::Binary, None) => {
            Ok(RuntimeArtifactGitHubReleaseAssetShape::Binary(
                RuntimeArtifactGitHubReleaseBinaryAssetShape {
                    file_name,
                    format: RuntimeArtifactGitHubReleaseBinaryAssetFormat::Binary,
                    sha256,
                },
            ))
        }
        (RuntimeArtifactGitHubReleaseAssetFormatWire::TarGz, Some(extracted_path)) => {
            Ok(RuntimeArtifactGitHubReleaseAssetShape::TarGz(
                RuntimeArtifactGitHubReleaseTarGzAssetShape {
                    file_name,
                    format: RuntimeArtifactGitHubReleaseTarGzAssetFormat::TarGz,
                    extracted_path,
                    sha256,
                },
            ))
        }
        (RuntimeArtifactGitHubReleaseAssetFormatWire::TarGz, None) => Err(
            serde::de::Error::custom("tar.gz assets must include extractedPath"),
        ),
        (RuntimeArtifactGitHubReleaseAssetFormatWire::Binary, Some(_)) => Err(
            serde::de::Error::custom("binary assets must not include extractedPath"),
        ),
    }
}

fn parse_required_non_empty_string<E>(value: Option<String>, field_name: &str) -> Result<String, E>
where
    E: serde::de::Error,
{
    let Some(value) = value else {
        return Err(serde::de::Error::custom(format!(
            "{field_name} must be present and non-empty"
        )));
    };
    if value.is_empty() {
        return Err(serde::de::Error::custom(format!(
            "{field_name} must be present and non-empty"
        )));
    }
    Ok(value)
}

/// One typed artifact install step.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum RuntimeArtifactInstallStep {
    #[serde(rename = "github_release_install")]
    GitHubReleaseInstall {
        #[serde(deserialize_with = "deserialize_non_empty_string")]
        repository: String,
        release: RuntimeArtifactGitHubReleaseSelector,
        asset: RuntimeArtifactGitHubReleaseInstallAsset,
        #[serde(rename = "installPath")]
        #[serde(deserialize_with = "deserialize_non_empty_string")]
        install_path: String,
        #[serde(rename = "timeoutMs")]
        timeout_ms: Option<u64>,
    },
    #[serde(rename = "mise_install")]
    MiseInstall {
        #[serde(deserialize_with = "deserialize_non_empty_string_vec")]
        tools: Vec<String>,
        force: Option<bool>,
        #[serde(rename = "timeoutMs")]
        timeout_ms: Option<u64>,
    },
    #[serde(rename = "exec")]
    Exec { command: RuntimeExecCommand },
}

/// The install lifecycle for one compiled runtime artifact.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeArtifactLifecycle {
    pub install: Vec<RuntimeArtifactInstallStep>,
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
    pub command: RuntimeExecCommand,
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
    pub runtime_id: String,
    pub runtime_key: String,
    pub client_id: String,
    pub endpoint_key: String,
    pub pty_launch: serde_json::Value,
}

/// Selected repository-backed skills to activate for the configured agent runtime.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledRuntimePlanSkills {
    pub origin_url: String,
    pub selected_skills: Vec<CompiledSkillSelection>,
}

/// One selected skill from a repository-backed skill source.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledSkillSelection {
    pub name: String,
    pub relative_path: String,
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

#[cfg(test)]
mod tests {
    use super::{
        CompiledEgressRoute, CompiledEgressRouteAuthInjectionType,
        CompiledEgressRouteCredentialResolver,
        CompiledLinkedPrincipalEgressCredentialResolutionMode, CompiledRuntimePlan,
        RuntimeArtifactGitHubReleaseInstallAsset, RuntimeArtifactGitHubReleaseSelector,
        RuntimeArtifactInstallStep,
    };

    #[test]
    fn rejects_unknown_top_level_runtime_plan_fields() {
        let error = serde_json::from_value::<CompiledRuntimePlan>(serde_json::json!({
          "sandboxProfileId": "sbp_01k00000000000000000000000",
          "version": 1,
          "image": {
            "source": "base",
            "imageRef": "registry.example.test/base:latest"
          },
          "egressRoutes": [],
          "artifacts": [],
          "workspaceSources": [],
          "runtimeClients": [],
          "agentRuntimes": [],
          "futureRuntimePlanField": true
        }))
        .expect_err("runtime plan decoder should reject unknown top-level fields");

        assert!(
            error
                .to_string()
                .contains("unknown field `futureRuntimePlanField`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn decodes_github_release_selector_exact_tag_shape() {
        let selector =
            serde_json::from_value::<RuntimeArtifactGitHubReleaseSelector>(serde_json::json!({
              "kind": "tag",
              "match": "exact",
              "tag": "rust-v0.137.0"
            }))
            .expect("github release selector should decode");

        assert!(matches!(
            selector,
            RuntimeArtifactGitHubReleaseSelector::Tag { .. }
        ));
    }

    #[test]
    fn decodes_github_release_asset_by_arch_shape() {
        let asset =
            serde_json::from_value::<RuntimeArtifactGitHubReleaseInstallAsset>(serde_json::json!({
              "kind": "by_arch",
              "x86_64": {
                "fileName": "codex-x86_64-unknown-linux-musl.tar.gz",
                "format": "tar.gz",
                "extractedPath": "codex-x86_64-unknown-linux-musl"
              },
              "aarch64": {
                "fileName": "codex-aarch64-unknown-linux-musl.tar.gz",
                "format": "tar.gz",
                "extractedPath": "codex-aarch64-unknown-linux-musl"
              }
            }))
            .expect("github release asset by_arch shape should decode");

        assert!(matches!(
            asset,
            RuntimeArtifactGitHubReleaseInstallAsset::ByArch { .. }
        ));
    }

    #[test]
    fn decodes_github_release_install_step_with_by_arch_asset() {
        let step = serde_json::from_value::<RuntimeArtifactInstallStep>(serde_json::json!({
          "op": "github_release_install",
          "repository": "openai/codex",
          "release": {
            "kind": "tag",
            "match": "exact",
            "tag": "rust-v0.137.0"
          },
          "asset": {
            "kind": "by_arch",
            "x86_64": {
              "fileName": "codex-x86_64-unknown-linux-musl.tar.gz",
              "format": "tar.gz",
              "extractedPath": "codex-x86_64-unknown-linux-musl"
            },
            "aarch64": {
              "fileName": "codex-aarch64-unknown-linux-musl.tar.gz",
              "format": "tar.gz",
              "extractedPath": "codex-aarch64-unknown-linux-musl"
            }
          },
          "installPath": "/usr/local/bin/codex"
        }))
        .expect("github release install step should decode");

        assert!(matches!(
            step,
            RuntimeArtifactInstallStep::GitHubReleaseInstall { .. }
        ));
    }

    #[test]
    fn decodes_egress_route_with_request_middleware_and_credential_headers() {
        let route = serde_json::from_value::<CompiledEgressRoute>(serde_json::json!({
          "egressRuleId": "egress_rule_bind_github",
          "bindingId": "bind_github",
          "familyId": "github",
          "variantId": "github-default",
          "match": {
            "hosts": ["api.github.com"],
            "pathPrefixes": ["/repos"],
            "methods": ["POST"]
          },
          "upstream": {
            "baseUrl": "https://api.github.com"
          },
          "authInjection": {
            "type": "bearer",
            "target": "authorization"
          },
          "additionalHeaders": {
            "accept": "application/vnd.github+json"
          },
          "additionalCredentialHeaders": [
            {
              "header": "x-extra-token",
              "credentialResolver": {
                "kind": "integration_connection",
                "connectionId": "icn_extra",
                "secretType": "api_key",
                "slotKey": "extra"
              }
            }
          ],
          "credentialResolver": {
            "kind": "integration_connection",
            "connectionId": "icn_github",
            "secretType": "github_app_installation_token",
            "resolverKey": "github_app_installation_token"
          },
          "requestMiddleware": ["append-session-link-to-github-markdown-body"]
        }))
        .expect("egress route should decode");

        assert_eq!(route.family_id, "github");
        assert_eq!(route.variant_id, "github-default");
        assert_eq!(
            route.request_middleware,
            Some(vec![
                "append-session-link-to-github-markdown-body".to_string()
            ])
        );
        assert_eq!(
            route
                .additional_credential_headers
                .expect("additional credential headers should decode")
                .len(),
            1
        );
        assert!(matches!(
            route.auth_injection.r#type,
            CompiledEgressRouteAuthInjectionType::Bearer
        ));
    }

    #[test]
    fn decodes_aws_sigv4_auth_injection_shape() {
        let route = serde_json::from_value::<CompiledEgressRoute>(serde_json::json!({
          "egressRuleId": "egress_rule_bind_s3",
          "bindingId": "bind_s3",
          "familyId": "aws",
          "variantId": "aws-default",
          "match": {
            "hosts": ["s3.amazonaws.com"]
          },
          "upstream": {
            "baseUrl": "https://s3.amazonaws.com"
          },
          "authInjection": {
            "type": "aws_sigv4",
            "service": "s3",
            "region": "us-east-1"
          },
          "credentialResolver": {
            "kind": "integration_connection",
            "connectionId": "icn_aws",
            "secretType": "aws_access_key"
          }
        }))
        .expect("aws sigv4 egress route should decode");

        assert!(matches!(
            route.auth_injection.r#type,
            CompiledEgressRouteAuthInjectionType::AwsSigv4
        ));
        assert_eq!(route.auth_injection.service.as_deref(), Some("s3"));
        assert_eq!(route.auth_injection.region.as_deref(), Some("us-east-1"));
        assert_eq!(route.auth_injection.target, None);
    }

    #[test]
    fn decodes_linked_principal_credential_resolver_shape() {
        let route = serde_json::from_value::<CompiledEgressRoute>(serde_json::json!({
          "egressRuleId": "egress_rule_bind_github_user",
          "bindingId": "bind_github_user",
          "familyId": "github",
          "variantId": "github-cloud",
          "match": {
            "hosts": ["api.github.com"]
          },
          "upstream": {
            "baseUrl": "https://api.github.com"
          },
          "authInjection": {
            "type": "bearer",
            "target": "authorization"
          },
          "credentialResolver": {
            "kind": "linked_principal",
            "providerFamily": "github",
            "integrationConnectionId": "conn_github",
            "credentialKind": "github_app_user_access_token",
            "actingUserRequired": true,
            "resolutionMode": "preferred"
          }
        }))
        .expect("linked principal egress route should decode");

        match route.credential_resolver {
            CompiledEgressRouteCredentialResolver::LinkedPrincipal {
                provider_family,
                integration_connection_id,
                credential_kind,
                acting_user_required,
                resolution_mode,
            } => {
                assert_eq!(provider_family, "github");
                assert_eq!(integration_connection_id, "conn_github");
                assert_eq!(
                    credential_kind,
                    Some("github_app_user_access_token".to_string())
                );
                assert!(acting_user_required);
                assert_eq!(
                    resolution_mode,
                    CompiledLinkedPrincipalEgressCredentialResolutionMode::Preferred
                );
            }
            other => panic!("expected linked principal resolver, got {other:?}"),
        }
    }

    #[test]
    fn decodes_mistle_mcp_token_credential_resolver_shape() {
        let route = serde_json::from_value::<CompiledEgressRoute>(serde_json::json!({
          "egressRuleId": "egress_rule_platform_mistle_mcp",
          "bindingId": "platform-mistle-mcp",
          "familyId": "mistle",
          "variantId": "mistle-mcp",
          "match": {
            "hosts": ["mcp.mistle.test"],
            "pathPrefixes": ["/mcp"]
          },
          "upstream": {
            "baseUrl": "https://mcp.mistle.test/mcp"
          },
          "authInjection": {
            "type": "bearer",
            "target": "authorization"
          },
          "credentialResolver": {
            "kind": "mistle_mcp_token",
            "apiKeyId": "apk_01k00000000000000000000000"
          }
        }))
        .expect("mistle mcp egress route should decode");

        match route.credential_resolver {
            CompiledEgressRouteCredentialResolver::MistleMcpToken { api_key_id } => {
                assert_eq!(api_key_id, "apk_01k00000000000000000000000");
            }
            other => panic!("expected mistle mcp token resolver, got {other:?}"),
        }
    }

    #[test]
    fn decodes_mistle_mcp_setup_assistant_token_credential_resolver_shape() {
        let route = serde_json::from_value::<CompiledEgressRoute>(serde_json::json!({
          "egressRuleId": "egress_rule_platform_mistle_mcp",
          "bindingId": "platform-mistle-mcp",
          "familyId": "mistle",
          "variantId": "mistle-mcp",
          "match": {
            "hosts": ["mcp.mistle.test"],
            "pathPrefixes": ["/mcp"]
          },
          "upstream": {
            "baseUrl": "https://mcp.mistle.test/mcp"
          },
          "authInjection": {
            "type": "bearer",
            "target": "authorization"
          },
          "credentialResolver": {
            "kind": "mistle_mcp_setup_assistant_token",
            "sandboxProfileId": "sbp_01k00000000000000000000000",
            "sandboxProfileVersion": 1
          }
        }))
        .expect("mistle mcp setup assistant egress route should decode");

        match route.credential_resolver {
            CompiledEgressRouteCredentialResolver::MistleMcpSetupAssistantToken {
                sandbox_profile_id,
                sandbox_profile_version,
            } => {
                assert_eq!(sandbox_profile_id, "sbp_01k00000000000000000000000");
                assert_eq!(sandbox_profile_version, 1);
            }
            other => panic!("expected mistle mcp setup assistant token resolver, got {other:?}"),
        }
    }
}
