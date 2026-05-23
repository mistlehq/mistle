//! Component selection helpers for daemon-wide health and readiness.
//!
//! Startup state combines generic process supervision with runtime-specific
//! proxy components; this module decides which component drives readiness for
//! each runtime client.

use std::collections::BTreeSet;

use crate::runtime;
use crate::runtime::readiness::RuntimeReadinessMode;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};

pub(super) fn determine_runtime_readiness_mode(
    supervisor_handle: &SandboxdSupervisorHandle,
) -> RuntimeReadinessMode {
    if supervisor_handle.tracks_component(SupervisedComponent::CodexAppServer) {
        RuntimeReadinessMode::Codex
    } else if supervisor_handle.tracks_component(SupervisedComponent::CodexProxy) {
        RuntimeReadinessMode::CodexProxyOnly
    } else if supervisor_handle.tracks_component(SupervisedComponent::OpenCodeServer) {
        RuntimeReadinessMode::OpenCode
    } else if supervisor_handle.tracks_component(SupervisedComponent::OpenCodeProxy) {
        RuntimeReadinessMode::OpenCodeProxyOnly
    } else if supervisor_handle.tracks_component(SupervisedComponent::PiRpcProcess) {
        RuntimeReadinessMode::Pi
    } else if supervisor_handle.tracks_component(SupervisedComponent::PiProxy) {
        RuntimeReadinessMode::PiProxyOnly
    } else {
        RuntimeReadinessMode::NoAgentRuntime
    }
}

pub(super) fn collect_tracked_components(
    runtime_plan: &runtime::CompiledRuntimePlan,
) -> BTreeSet<SupervisedComponent> {
    let mut tracked_components = BTreeSet::from([
        SupervisedComponent::Sandboxd,
        SupervisedComponent::TunnelSession,
    ]);

    if !runtime_plan.egress_routes.is_empty() {
        tracked_components.insert(SupervisedComponent::EgressProxy);
    }

    if runtime_plan
        .agent_runtimes
        .iter()
        .any(|agent_runtime| agent_runtime.runtime_id == "codex")
    {
        tracked_components.insert(SupervisedComponent::CodexProxy);
        tracked_components.insert(SupervisedComponent::CodexAppServer);
    }

    if runtime_plan
        .agent_runtimes
        .iter()
        .any(|agent_runtime| agent_runtime.runtime_id == "opencode")
    {
        tracked_components.insert(SupervisedComponent::OpenCodeProxy);
        tracked_components.insert(SupervisedComponent::OpenCodeServer);
    }

    if runtime_plan
        .agent_runtimes
        .iter()
        .any(|agent_runtime| agent_runtime.runtime_id == "pi")
    {
        tracked_components.insert(SupervisedComponent::PiProxy);
        tracked_components.insert(SupervisedComponent::PiRpcProcess);
    }

    tracked_components
}
