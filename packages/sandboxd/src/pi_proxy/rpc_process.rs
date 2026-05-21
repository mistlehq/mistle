use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::pi_proxy::{PiProxyError, PiProxyState};
use crate::supervision::SupervisedComponent;

const PI_RPC_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const PI_RPC_MONITOR_POLL_INTERVAL: Duration = Duration::from_millis(250);

pub(super) struct PiRpcChild {
    pub(super) child: Child,
    pub(super) stdin: ChildStdin,
    pub(super) receiver: Receiver<PiRpcOutput>,
    reader_thread: JoinHandle<()>,
    cwd: Option<String>,
}

#[derive(Debug)]
pub(super) enum PiRpcOutput {
    Line(Value),
    Error(String),
    Eof,
}

fn should_replace_pi_rpc_child_for_cwd(child: &PiRpcChild, requested_cwd: Option<&str>) -> bool {
    child.cwd.is_none() && requested_cwd.is_some()
}

fn terminate_pi_rpc_child(mut child: PiRpcChild) {
    let _ = child.child.kill();
    let deadline = Instant::now() + PI_RPC_SHUTDOWN_TIMEOUT;
    while Instant::now() < deadline {
        match child.child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => break,
        }
    }
    let _ = child.reader_thread.join();
}

pub(super) fn spawn_pi_rpc_process_monitor(
    state: Arc<PiProxyState>,
    shutdown_requested: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        run_pi_rpc_process_monitor(state, shutdown_requested);
    })
}

fn run_pi_rpc_process_monitor(state: Arc<PiProxyState>, shutdown_requested: Arc<AtomicBool>) {
    while !shutdown_requested.load(Ordering::Relaxed) {
        if let Err(error) = state.restart_exited_child() {
            eprintln!("sandboxd failed to restart exited Pi RPC process: {error}");
        }
        thread::sleep(PI_RPC_MONITOR_POLL_INTERVAL);
    }
}

impl PiProxyState {
    pub(super) fn ensure_child(&self, cwd: Option<&str>) -> Result<(), PiProxyError> {
        let mut guard = self
            .child
            .lock()
            .map_err(|_| PiProxyError::InvalidRequest("Pi child lock was poisoned".to_string()))?;
        if guard
            .as_ref()
            .is_some_and(|child| !should_replace_pi_rpc_child_for_cwd(child, cwd))
        {
            return Ok(());
        }
        if let Some(child) = guard.take() {
            terminate_pi_rpc_child(child);
            self.set_active(false);
            self.mark_pi_rpc_process_stopped();
        }
        self.mark_pi_rpc_process_starting();

        let mut command = Command::new(&self.config.pi_cli_path);
        command.arg("--mode").arg("rpc");
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        command.stdin(Stdio::piped()).stdout(Stdio::piped());
        command.stderr(Stdio::inherit());
        for (key, value) in &self.config.env {
            command.env(key, value);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.mark_pi_rpc_process_restarting(error.to_string());
                return Err(PiProxyError::SpawnPi(error));
            }
        };
        let pid = child.id();
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                self.mark_pi_rpc_process_restarting("missing Pi RPC stdin".to_string());
                let _ = child.kill();
                return Err(PiProxyError::MissingPiStdin);
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                self.mark_pi_rpc_process_restarting("missing Pi RPC stdout".to_string());
                let _ = child.kill();
                return Err(PiProxyError::MissingPiStdout);
            }
        };
        let (sender, receiver) = mpsc::channel();
        let reader_thread = spawn_pi_stdout_reader(stdout, sender);
        *guard = Some(PiRpcChild {
            child,
            stdin,
            receiver,
            reader_thread,
            cwd: cwd.map(ToString::to_string),
        });
        self.mark_pi_rpc_process_healthy(pid);
        Ok(())
    }

    pub(super) fn restart_exited_child(&self) -> Result<(), PiProxyError> {
        let (cwd, exit_description) = {
            let mut guard = self.child.lock().map_err(|_| {
                PiProxyError::InvalidRequest("Pi child lock was poisoned".to_string())
            })?;
            let Some(child) = guard.as_mut() else {
                return Ok(());
            };
            let Some(exit_status) = child
                .child
                .try_wait()
                .map_err(|error| PiProxyError::InvalidRequest(error.to_string()))?
            else {
                return Ok(());
            };
            let cwd = child.cwd.clone();
            let exit_description = describe_pi_rpc_process_exit(exit_status);
            let Some(child) = guard.take() else {
                return Ok(());
            };
            terminate_pi_rpc_child(child);
            (cwd, exit_description)
        };

        self.set_active(false);
        self.mark_pi_rpc_process_restarting(exit_description);
        self.ensure_child(cwd.as_deref())
    }

    pub(super) fn shutdown_child(&self) {
        let child = match self.child.lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => None,
        };
        let Some(child) = child else {
            return;
        };
        terminate_pi_rpc_child(child);
        self.set_active(false);
        self.mark_pi_rpc_process_stopped();
    }

    fn pi_rpc_process_details(&self, pid: Option<u32>) -> BTreeMap<String, String> {
        let mut details =
            BTreeMap::from([("cliPath".to_string(), self.config.pi_cli_path.clone())]);
        if let Some(pid) = pid {
            details.insert("pid".to_string(), pid.to_string());
        }
        details
    }

    fn mark_pi_rpc_process_starting(&self) {
        if !self
            .supervisor_handle
            .tracks_component(SupervisedComponent::PiRpcProcess)
        {
            return;
        }
        self.supervisor_handle.replace_component_details(
            SupervisedComponent::PiRpcProcess,
            self.pi_rpc_process_details(None),
        );
        self.supervisor_handle
            .mark_component_starting(SupervisedComponent::PiRpcProcess);
    }

    fn mark_pi_rpc_process_healthy(&self, pid: u32) {
        if !self
            .supervisor_handle
            .tracks_component(SupervisedComponent::PiRpcProcess)
        {
            return;
        }
        self.supervisor_handle.replace_component_details(
            SupervisedComponent::PiRpcProcess,
            self.pi_rpc_process_details(Some(pid)),
        );
        self.supervisor_handle
            .mark_component_healthy(SupervisedComponent::PiRpcProcess);
    }

    pub(super) fn mark_pi_rpc_process_restarting(&self, error: String) {
        if !self
            .supervisor_handle
            .tracks_component(SupervisedComponent::PiRpcProcess)
        {
            return;
        }
        self.supervisor_handle
            .mark_component_restarting(SupervisedComponent::PiRpcProcess, error);
    }

    fn mark_pi_rpc_process_stopped(&self) {
        if !self
            .supervisor_handle
            .tracks_component(SupervisedComponent::PiRpcProcess)
        {
            return;
        }
        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::PiRpcProcess);
    }
}

fn describe_pi_rpc_process_exit(status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(0) => "Pi RPC process exited".to_string(),
        Some(code) => format!("Pi RPC process exited with code {code}"),
        None => "Pi RPC process exited with signal".to_string(),
    }
}

fn spawn_pi_stdout_reader(
    stdout: std::process::ChildStdout,
    sender: Sender<PiRpcOutput>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            match line_result {
                Ok(line) => match serde_json::from_str::<Value>(&line) {
                    Ok(value) => {
                        let _ = sender.send(PiRpcOutput::Line(value));
                    }
                    Err(error) => {
                        let _ = sender.send(PiRpcOutput::Error(error.to_string()));
                    }
                },
                Err(error) => {
                    let _ = sender.send(PiRpcOutput::Error(error.to_string()));
                    return;
                }
            }
        }
        let _ = sender.send(PiRpcOutput::Eof);
    })
}
