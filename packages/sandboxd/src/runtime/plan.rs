use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledRuntimePlan {
    pub artifacts: Vec<CompiledRuntimeArtifact>,
    pub workspace_sources: Vec<CompiledWorkspaceSource>,
    pub runtime_clients: Vec<RuntimeClient>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeArtifactCommand {
    pub args: Vec<String>,
    pub env: Option<BTreeMap<String, String>>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeArtifactLifecycle {
    pub install: Vec<RuntimeArtifactCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompiledRuntimeArtifact {
    pub artifact_key: String,
    pub name: String,
    pub env: Option<BTreeMap<String, String>>,
    pub lifecycle: RuntimeArtifactLifecycle,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClientSetupFile {
    pub file_id: String,
    pub path: String,
    pub mode: u32,
    pub content: String,
    pub write_mode: Option<RuntimeFileWriteMode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeFileWriteMode {
    #[serde(rename = "overwrite")]
    Overwrite,
    #[serde(rename = "if-absent")]
    IfAbsent,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClientSetup {
    pub env: BTreeMap<String, String>,
    pub files: Vec<RuntimeClientSetupFile>,
    pub launch_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeClient {
    pub client_id: String,
    pub setup: RuntimeClientSetup,
    pub processes: Vec<serde_json::Value>,
    pub endpoints: Vec<serde_json::Value>,
}

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
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum WorkspaceSourceResourceKind {
    #[serde(rename = "repository")]
    Repository,
}
