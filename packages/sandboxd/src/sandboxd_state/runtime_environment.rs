use std::collections::BTreeMap;

use crate::egress_proxy::EgressProxy;
use crate::protocol::startup::StartupInput;
use crate::runtime;
use crate::sandboxd_state::lifecycle::{
    DEFAULT_GLOBAL_GIT_CONFIG_PATH, GLOBAL_GIT_CONFIG_ENV_NAME,
    MISTLE_SANDBOX_INSTANCE_ID_ENV_NAME, MISTLE_SANDBOX_PROFILE_ID_ENV_NAME,
    MISTLE_SANDBOX_PROFILE_VERSION_ENV_NAME,
};

pub(super) fn collect_runtime_environment(
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

pub(super) fn merge_managed_runtime_environment(
    mut runtime_env: BTreeMap<String, String>,
    mistle_context_env: &BTreeMap<String, String>,
    egress_proxy: Option<&EgressProxy>,
) -> Result<BTreeMap<String, String>, String> {
    for (name, value) in mistle_context_env {
        insert_managed_runtime_environment(&mut runtime_env, name, value)?;
    }

    insert_managed_runtime_environment(
        &mut runtime_env,
        GLOBAL_GIT_CONFIG_ENV_NAME,
        DEFAULT_GLOBAL_GIT_CONFIG_PATH,
    )?;

    if let Some(egress_proxy) = egress_proxy {
        for (name, value) in egress_proxy.runtime_env() {
            insert_managed_runtime_environment(&mut runtime_env, name, value)?;
        }
    }

    Ok(runtime_env)
}

pub(super) fn collect_mistle_context_runtime_environment(
    startup_input: &StartupInput,
    sandbox_instance_id: &str,
) -> Result<BTreeMap<String, String>, String> {
    let Some(sandbox_profile_id) = startup_input
        .runtime_plan
        .get("sandboxProfileId")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
    else {
        return Err("runtime plan sandboxProfileId is required for managed env".to_string());
    };
    let Some(sandbox_profile_version) = startup_input
        .runtime_plan
        .get("version")
        .and_then(serde_json::Value::as_u64)
    else {
        return Err("runtime plan version is required for managed env".to_string());
    };

    Ok(BTreeMap::from([
        (
            MISTLE_SANDBOX_INSTANCE_ID_ENV_NAME.to_string(),
            sandbox_instance_id.to_string(),
        ),
        (
            MISTLE_SANDBOX_PROFILE_ID_ENV_NAME.to_string(),
            sandbox_profile_id.to_string(),
        ),
        (
            MISTLE_SANDBOX_PROFILE_VERSION_ENV_NAME.to_string(),
            sandbox_profile_version.to_string(),
        ),
    ]))
}

fn insert_managed_runtime_environment(
    runtime_env: &mut BTreeMap<String, String>,
    name: &str,
    value: &str,
) -> Result<(), String> {
    match runtime_env.get(name) {
        Some(existing_value) if existing_value != value => {
            return Err(format!(
                "runtime plan artifacts define managed env '{name}', which sandboxd reserves"
            ));
        }
        Some(_) => {}
        None => {
            runtime_env.insert(name.to_string(), value.to_string());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::protocol::startup::{GitIdentity, StartupExecutionMode, StartupInput, StartupMode};
    use crate::runtime::{
        CompiledRuntimeArtifact, CompiledRuntimePlan, CompiledRuntimePlanImage,
        CompiledRuntimePlanImageSource, RuntimeArtifactLifecycle,
    };
    use crate::sandboxd_state::lifecycle::{
        DEFAULT_GLOBAL_GIT_CONFIG_PATH, GLOBAL_GIT_CONFIG_ENV_NAME,
        MISTLE_SANDBOX_INSTANCE_ID_ENV_NAME, MISTLE_SANDBOX_PROFILE_ID_ENV_NAME,
        MISTLE_SANDBOX_PROFILE_VERSION_ENV_NAME,
    };
    use crate::sandboxd_state::runtime_environment::{
        collect_mistle_context_runtime_environment, collect_runtime_environment,
        merge_managed_runtime_environment,
    };

    #[test]
    fn collects_runtime_environment_from_artifacts() {
        let runtime_plan = CompiledRuntimePlan {
            image: test_runtime_plan_image(CompiledRuntimePlanImageSource::Base),
            setup_script: None,
            egress_routes: Vec::new(),
            artifacts: vec![
                CompiledRuntimeArtifact {
                    artifact_key: "gh-cli".to_string(),
                    name: "GitHub CLI".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "token-value".to_string(),
                    )])),
                    lifecycle: RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
                CompiledRuntimeArtifact {
                    artifact_key: "jira-cli".to_string(),
                    name: "Jira CLI".to_string(),
                    env: Some(BTreeMap::from([(
                        "JIRA_BASE_URL".to_string(),
                        "https://mistle.atlassian.net".to_string(),
                    )])),
                    lifecycle: RuntimeArtifactLifecycle {
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
            image: test_runtime_plan_image(CompiledRuntimePlanImageSource::Base),
            setup_script: None,
            egress_routes: Vec::new(),
            artifacts: vec![
                CompiledRuntimeArtifact {
                    artifact_key: "artifact-a".to_string(),
                    name: "Artifact A".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "first".to_string(),
                    )])),
                    lifecycle: RuntimeArtifactLifecycle {
                        install: Vec::new(),
                    },
                },
                CompiledRuntimeArtifact {
                    artifact_key: "artifact-b".to_string(),
                    name: "Artifact B".to_string(),
                    env: Some(BTreeMap::from([(
                        "GH_TOKEN".to_string(),
                        "second".to_string(),
                    )])),
                    lifecycle: RuntimeArtifactLifecycle {
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

    #[test]
    fn adds_default_global_git_config_to_managed_runtime_environment() {
        let runtime_env =
            merge_managed_runtime_environment(BTreeMap::new(), &mistle_context_env(), None)
                .expect("managed runtime env should merge");

        assert_eq!(
            runtime_env,
            BTreeMap::from([
                (
                    GLOBAL_GIT_CONFIG_ENV_NAME.to_string(),
                    DEFAULT_GLOBAL_GIT_CONFIG_PATH.to_string(),
                ),
                (
                    MISTLE_SANDBOX_INSTANCE_ID_ENV_NAME.to_string(),
                    "sbi_test_001".to_string(),
                ),
                (
                    MISTLE_SANDBOX_PROFILE_ID_ENV_NAME.to_string(),
                    "sbp_test_001".to_string(),
                ),
                (
                    MISTLE_SANDBOX_PROFILE_VERSION_ENV_NAME.to_string(),
                    "7".to_string(),
                ),
            ])
        );
    }

    #[test]
    fn allows_runtime_plan_to_define_path() {
        let runtime_env = merge_managed_runtime_environment(
            BTreeMap::from([(
                "PATH".to_string(),
                "/usr/local/bin:/usr/bin:/bin".to_string(),
            )]),
            &mistle_context_env(),
            None,
        )
        .expect("runtime plan path should be preserved");

        assert_eq!(
            runtime_env.get("PATH"),
            Some(&"/usr/local/bin:/usr/bin:/bin".to_string())
        );
        assert_eq!(
            runtime_env.get(GLOBAL_GIT_CONFIG_ENV_NAME),
            Some(&DEFAULT_GLOBAL_GIT_CONFIG_PATH.to_string())
        );
    }

    #[test]
    fn rejects_runtime_plan_global_git_config_override() {
        let error = merge_managed_runtime_environment(
            BTreeMap::from([(
                GLOBAL_GIT_CONFIG_ENV_NAME.to_string(),
                "/tmp/not-sandboxd-owned".to_string(),
            )]),
            &mistle_context_env(),
            None,
        )
        .expect_err("managed global git config should be reserved");

        assert_eq!(
            error,
            "runtime plan artifacts define managed env 'GIT_CONFIG_GLOBAL', which sandboxd reserves"
        );
    }

    #[test]
    fn extracts_mistle_context_runtime_environment_from_startup_input() {
        let startup_input = build_startup_input(
            StartupMode::New,
            StartupExecutionMode::Session,
            "ws://gateway.example.test/sbi_context_env_001",
            minimal_runtime_plan_json(),
            None,
        );

        let runtime_env =
            collect_mistle_context_runtime_environment(&startup_input, "sbi_context_env_001")
                .expect("mistle context env should collect");

        assert_eq!(
            runtime_env,
            BTreeMap::from([
                (
                    MISTLE_SANDBOX_INSTANCE_ID_ENV_NAME.to_string(),
                    "sbi_context_env_001".to_string(),
                ),
                (
                    MISTLE_SANDBOX_PROFILE_ID_ENV_NAME.to_string(),
                    "sbp_test_001".to_string(),
                ),
                (
                    MISTLE_SANDBOX_PROFILE_VERSION_ENV_NAME.to_string(),
                    "1".to_string(),
                ),
            ])
        );
    }

    fn test_runtime_plan_image(source: CompiledRuntimePlanImageSource) -> CompiledRuntimePlanImage {
        CompiledRuntimePlanImage {
            source,
            image_ref: "registry.example.test/base:latest".to_string(),
        }
    }

    fn mistle_context_env() -> BTreeMap<String, String> {
        BTreeMap::from([
            (
                MISTLE_SANDBOX_INSTANCE_ID_ENV_NAME.to_string(),
                "sbi_test_001".to_string(),
            ),
            (
                MISTLE_SANDBOX_PROFILE_ID_ENV_NAME.to_string(),
                "sbp_test_001".to_string(),
            ),
            (
                MISTLE_SANDBOX_PROFILE_VERSION_ENV_NAME.to_string(),
                "7".to_string(),
            ),
        ])
    }

    fn build_startup_input(
        startup_mode: StartupMode,
        execution_mode: StartupExecutionMode,
        tunnel_gateway_ws_url: &str,
        runtime_plan: serde_json::Value,
        git_identity: Option<GitIdentity>,
    ) -> StartupInput {
        StartupInput {
            startup_mode,
            execution_mode,
            operation_kind: crate::protocol::startup::StartupOperationKind::Start,
            bootstrap_token: "bootstrap-token-value".to_string(),
            tunnel_exchange_token: "tunnel-exchange-token-value".to_string(),
            tunnel_gateway_ws_url: tunnel_gateway_ws_url.to_string(),
            runtime_plan,
            acting_user_id: None,
            git_identity,
            transparent_proxy: None,
        }
    }

    fn minimal_runtime_plan_json() -> serde_json::Value {
        serde_json::json!({
            "sandboxProfileId": "sbp_test_001",
            "version": 1,
            "image": {
                "source": "base",
                "imageRef": "registry.example.test/base:latest"
            },
            "egressRoutes": [],
            "artifacts": [],
            "runtimeClients": []
        })
    }
}
