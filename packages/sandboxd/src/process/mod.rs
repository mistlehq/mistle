//! Runtime-client process supervision for `sandboxd`.
//!
//! This module turns compiled runtime-plan process entries into child
//! processes, waits for their declared readiness checks, and applies the stop
//! policies used during daemon shutdown.

use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::fmt;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::cgroups::PlatformScopePaths;
use crate::runtime::{
    RuntimeClientProcessReadiness, RuntimeClientProcessStopPolicy, RuntimeExecCommand,
};
use crate::supervision::SandboxdSupervisorHandle;

mod codex_app_server;
mod control;
mod lifecycle;
mod manager;
mod opencode_server;
mod output;
mod readiness;

use codex_app_server::*;
use lifecycle::*;
pub use manager::{
    PlatformProcessScopeInput, flatten_runtime_client_processes,
    start_runtime_client_process_manager,
    start_runtime_client_process_manager_with_platform_scopes,
    start_runtime_client_process_manager_with_supervisor,
    start_runtime_client_process_manager_with_supervisor_and_observer,
};
use opencode_server::*;
use output::*;
use readiness::*;

/// Poll interval for readiness retries while a child process is still starting.
pub const DEFAULT_PROCESS_READINESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
/// Poll interval for exit checks while waiting for a process to stop.
pub const DEFAULT_PROCESS_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);
/// Poll interval for post-readiness child monitoring.
pub const DEFAULT_PROCESS_MONITOR_POLL_INTERVAL: Duration = Duration::from_millis(1_000);
/// Timeout budget for post-start Codex app-server readiness probes.
pub const CODEX_APP_SERVER_POST_START_READINESS_TIMEOUT: Duration = Duration::from_millis(1_000);
/// Number of consecutive post-start readiness failures before restarting Codex.
pub const CODEX_APP_SERVER_POST_START_FAILURE_THRESHOLD: u8 = 3;
/// Number of consecutive post-start readiness failures before OpenCode is marked unhealthy.
pub const OPENCODE_SERVER_POST_START_FAILURE_THRESHOLD: u8 = 3;

/// Captures one runtime client process after client-level environment merging.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeClientProcessSpec {
    pub process_key: String,
    pub command: RuntimeExecCommand,
    pub readiness: RuntimeClientProcessReadiness,
    pub stop: RuntimeClientProcessStopPolicy,
}

pub trait RuntimeClientProcessObserver {
    fn record_process_started(&self, process_spec: &RuntimeClientProcessSpec);

    fn record_process_completed(&self, process_spec: &RuntimeClientProcessSpec);
}

/// Owns the set of runtime client processes started for the current session input.
#[derive(Debug)]
pub struct RuntimeClientProcessManager {
    processes: Vec<RunningRuntimeClientProcess>,
    codex_app_server_observation_handle: Option<CodexAppServerObservationHandle>,
    codex_app_server_control_handle: Option<CodexAppServerControlHandle>,
    opencode_server_control_handle: Option<OpenCodeServerControlHandle>,
    monitor_shutdown_requested: Arc<AtomicBool>,
    monitor_threads: Vec<JoinHandle<()>>,
    supervisor_handle: SandboxdSupervisorHandle,
}

/// Shared registry of platform process cgroups owned by runtime client processes.
#[derive(Clone, Debug, Default)]
pub struct PlatformProcessRegistry {
    scopes: Arc<Mutex<BTreeMap<String, PlatformProcessScopeSnapshot>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformProcessScopeSnapshot {
    pub process_key: String,
    pub scope_paths: PlatformScopePaths,
    pub supervised_root_pid: u32,
}

impl PlatformProcessRegistry {
    pub fn replace_scope(
        &self,
        registry_key: String,
        process_key: String,
        scope_paths: PlatformScopePaths,
        supervised_root_pid: u32,
    ) -> Result<(), String> {
        self.scopes
            .lock()
            .map_err(|error| format!("platform process registry lock was poisoned: {error}"))?
            .insert(
                registry_key,
                PlatformProcessScopeSnapshot {
                    process_key,
                    scope_paths,
                    supervised_root_pid,
                },
            );
        Ok(())
    }

    pub fn update_supervised_root_pid(
        &self,
        registry_key: &str,
        supervised_root_pid: u32,
    ) -> Result<(), String> {
        if let Some(scope) = self
            .scopes
            .lock()
            .map_err(|error| format!("platform process registry lock was poisoned: {error}"))?
            .get_mut(registry_key)
        {
            scope.supervised_root_pid = supervised_root_pid;
        }
        Ok(())
    }

    pub fn remove_scope(&self, registry_key: &str) -> Result<(), String> {
        self.scopes
            .lock()
            .map_err(|error| format!("platform process registry lock was poisoned: {error}"))?
            .remove(registry_key);
        Ok(())
    }

    pub fn snapshots(&self) -> Result<Vec<PlatformProcessScopeSnapshot>, String> {
        Ok(self
            .scopes
            .lock()
            .map_err(|error| format!("platform process registry lock was poisoned: {error}"))?
            .values()
            .cloned()
            .collect())
    }
}

/// Tracks one live child process together with the spec that produced it.
#[derive(Debug)]
struct RunningRuntimeClientProcess {
    spec: RuntimeClientProcessSpec,
    child: Arc<Mutex<Child>>,
    output_capture: ProcessOutputCapture,
    platform_scope: Option<RuntimeClientProcessPlatformScope>,
}

#[derive(Clone, Debug)]
struct RuntimeClientProcessPlatformScope {
    registry_key: String,
    process_key: String,
    scope_paths: PlatformScopePaths,
    registry: PlatformProcessRegistry,
}

#[derive(Clone, Debug)]
struct ProcessOutputCapture {
    stdout: Arc<Mutex<TailBuffer>>,
    stderr: Arc<Mutex<TailBuffer>>,
    capture_threads: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

#[derive(Debug)]
struct TailBuffer {
    max_bytes: usize,
    bytes: VecDeque<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexAppServerObservation {
    pub process_key: String,
    pub pid: Option<u32>,
    pub readiness_url: Option<String>,
    pub is_alive: bool,
    pub last_exit_status: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CodexAppServerObservationHandle {
    state: Arc<Mutex<CodexAppServerObservation>>,
}

impl CodexAppServerObservationHandle {
    pub fn snapshot(&self) -> CodexAppServerObservation {
        self.state
            .lock()
            .expect("Codex app-server observation lock should not be poisoned")
            .clone()
    }
}

#[derive(Clone, Debug)]
pub struct CodexAppServerControlHandle {
    managed_process: Arc<ManagedCodexAppServerProcess>,
}

#[derive(Clone, Debug)]
pub struct OpenCodeServerControlHandle {
    managed_process: Arc<ManagedOpenCodeServerProcess>,
}

#[derive(Debug)]
struct ManagedCodexAppServerProcess {
    spec: RuntimeClientProcessSpec,
    child: Arc<Mutex<Child>>,
    output_capture: ProcessOutputCapture,
    platform_scope: Option<RuntimeClientProcessPlatformScope>,
    observation_handle: CodexAppServerObservationHandle,
    supervisor_handle: SandboxdSupervisorHandle,
    restart_lock: Mutex<()>,
    restart_in_progress: AtomicBool,
}

#[derive(Debug)]
struct ManagedOpenCodeServerProcess {
    spec: RuntimeClientProcessSpec,
    child: Arc<Mutex<Child>>,
    output_capture: ProcessOutputCapture,
    platform_scope: Option<RuntimeClientProcessPlatformScope>,
    supervisor_handle: SandboxdSupervisorHandle,
    restart_lock: Mutex<()>,
    restart_in_progress: AtomicBool,
}

/// Describes why runtime client process startup, readiness, or shutdown failed.
#[derive(Debug)]
pub enum ProcessManagerError {
    StartProcess {
        process_index: usize,
        process_key: String,
        error: String,
        output_tails: Box<ProcessOutputTails>,
    },
    ReadinessCheck {
        process_index: usize,
        process_key: String,
        error: String,
        details: Box<ProcessReadinessFailureDetails>,
    },
    StopProcesses(String),
}

#[derive(Debug, Clone, Default)]
pub struct ProcessOutputTails {
    pub stdout_tail: Option<String>,
    pub stderr_tail: Option<String>,
    pub stdout_captured: bool,
    pub stderr_captured: bool,
}

#[derive(Debug, Clone)]
pub struct ProcessReadinessFailureDetails {
    pub readiness_type: String,
    pub readiness_target: String,
    pub timeout_ms: u64,
    pub output_tails: ProcessOutputTails,
}

impl fmt::Display for ProcessManagerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StartProcess {
                process_index,
                process_key,
                error,
                ..
            } => write!(
                f,
                "runtime client process[{process_index}] failed to start (processKey={process_key}): {error}"
            ),
            Self::ReadinessCheck {
                process_index,
                process_key,
                error,
                ..
            } => write!(
                f,
                "runtime client process[{process_index}] readiness check failed (processKey={process_key}): {error}"
            ),
            Self::StopProcesses(error) => {
                write!(f, "failed to stop runtime client processes: {error}")
            }
        }
    }
}

impl std::error::Error for ProcessManagerError {}
