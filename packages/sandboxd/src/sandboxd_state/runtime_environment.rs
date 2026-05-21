use std::collections::BTreeMap;

use crate::egress_proxy::EgressProxy;
use crate::protocol::startup::StartupInput;
use crate::runtime;
use crate::sandboxd_state::{
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
