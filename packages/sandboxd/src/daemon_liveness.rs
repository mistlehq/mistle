//! Low-overhead daemon liveness diagnostics for `sandboxd`.
//!
//! The sampler runs in its own thread and only writes durable/remote events on
//! state transitions. The current sample is still reflected in the supervision
//! health snapshot so local health checks can inspect resource pressure.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

use crate::supervision::{DAEMON_LIVENESS_JOURNAL_ERROR_DETAIL, SandboxdSupervisorHandle};
use crate::time::{Clock, format_rfc3339_timestamp};

pub const DEFAULT_LIVENESS_JOURNAL_PATH: &str = "/run/mistle/sandboxd/liveness.log";

const LIVENESS_JOURNAL_PATH_ENV: &str = "MISTLE_SANDBOXD_LIVENESS_LOG_PATH";
const DEFAULT_SAMPLE_INTERVAL: Duration = Duration::from_secs(10);
const DEFAULT_LAG_THRESHOLD: Duration = Duration::from_secs(30);
const PROC_ROOT: &str = "/proc";
const CGROUP_ROOT: &str = "/sys/fs/cgroup";

/// Owns the background liveness sampler thread.
pub struct DaemonLivenessMonitor {
    shutdown_sender: mpsc::Sender<()>,
    thread: Option<JoinHandle<Result<(), String>>>,
}

impl DaemonLivenessMonitor {
    pub fn start(supervisor_handle: SandboxdSupervisorHandle, clock: Arc<dyn Clock>) -> Self {
        let (shutdown_sender, shutdown_receiver) = mpsc::channel();
        let config = DaemonLivenessConfig::default();
        let thread = thread::spawn(move || {
            run_liveness_sampler(supervisor_handle, clock, config, shutdown_receiver)
        });

        Self {
            shutdown_sender,
            thread: Some(thread),
        }
    }

    pub fn close(mut self) -> Result<(), String> {
        let _ = self.shutdown_sender.send(());
        let Some(thread) = self.thread.take() else {
            return Ok(());
        };

        match thread.join() {
            Ok(result) => result,
            Err(_) => Err("sandboxd liveness monitor thread panicked".to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DaemonLivenessConfig {
    sample_interval: Duration,
    lag_threshold: Duration,
    journal_path: PathBuf,
    proc_root: PathBuf,
    cgroup_root: PathBuf,
}

impl Default for DaemonLivenessConfig {
    fn default() -> Self {
        Self {
            sample_interval: DEFAULT_SAMPLE_INTERVAL,
            lag_threshold: DEFAULT_LAG_THRESHOLD,
            journal_path: liveness_journal_path(),
            proc_root: PathBuf::from(PROC_ROOT),
            cgroup_root: PathBuf::from(CGROUP_ROOT),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DaemonLivenessSample {
    observed_at_ms: u64,
    lag_ms: u64,
    threshold_ms: u64,
    details: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DaemonLivenessAction {
    SampleOnly,
    LagDetected,
    Recovered,
}

#[derive(Debug, Default)]
struct DaemonLivenessState {
    lagging: bool,
    max_lag_ms: u64,
}

impl DaemonLivenessState {
    fn evaluate(&mut self, sample: &mut DaemonLivenessSample) -> DaemonLivenessAction {
        self.max_lag_ms = self.max_lag_ms.max(sample.lag_ms);
        sample
            .details
            .insert("maxLagMs".to_string(), self.max_lag_ms.to_string());

        if sample.lag_ms > sample.threshold_ms {
            if self.lagging {
                return DaemonLivenessAction::SampleOnly;
            }
            self.lagging = true;
            return DaemonLivenessAction::LagDetected;
        }

        if self.lagging {
            self.lagging = false;
            return DaemonLivenessAction::Recovered;
        }

        DaemonLivenessAction::SampleOnly
    }
}

fn run_liveness_sampler(
    supervisor_handle: SandboxdSupervisorHandle,
    clock: Arc<dyn Clock>,
    config: DaemonLivenessConfig,
    shutdown_receiver: mpsc::Receiver<()>,
) -> Result<(), String> {
    let threshold_ms = duration_millis(config.lag_threshold);
    let mut state = DaemonLivenessState::default();

    loop {
        let sleep_started_at = Instant::now();
        match shutdown_receiver.recv_timeout(config.sample_interval) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        let now_ms = clock.now_ms();
        let lag_ms = elapsed_lag_ms(sleep_started_at.elapsed(), config.sample_interval);

        let mut sample = collect_liveness_sample(&config, now_ms, lag_ms, threshold_ms);
        let action = state.evaluate(&mut sample);
        supervisor_handle.record_daemon_liveness_sample(sample.details.clone());

        match action {
            DaemonLivenessAction::SampleOnly => {}
            DaemonLivenessAction::LagDetected => {
                supervisor_handle.record_daemon_liveness_lag_detected(
                    sample.details.clone(),
                    sample.lag_ms,
                    sample.threshold_ms,
                );
                record_liveness_journal_edge(
                    &supervisor_handle,
                    config.journal_path.as_path(),
                    clock.as_ref(),
                    supervisor_handle.sandbox_instance_id(),
                    "warn",
                    "daemon_liveness_lag_detected",
                    &sample,
                );
            }
            DaemonLivenessAction::Recovered => {
                supervisor_handle.record_daemon_liveness_recovered(
                    sample.details.clone(),
                    sample.lag_ms,
                    sample.threshold_ms,
                );
                record_liveness_journal_edge(
                    &supervisor_handle,
                    config.journal_path.as_path(),
                    clock.as_ref(),
                    supervisor_handle.sandbox_instance_id(),
                    "info",
                    "daemon_liveness_recovered",
                    &sample,
                );
            }
        }
    }

    Ok(())
}

fn record_liveness_journal_edge(
    supervisor_handle: &SandboxdSupervisorHandle,
    journal_path: &Path,
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    level: &str,
    event: &str,
    sample: &DaemonLivenessSample,
) {
    match append_liveness_journal_event(
        journal_path,
        clock,
        sandbox_instance_id,
        level,
        event,
        sample,
    ) {
        Ok(()) => supervisor_handle.remove_component_detail(
            crate::supervision::SupervisedComponent::Sandboxd,
            DAEMON_LIVENESS_JOURNAL_ERROR_DETAIL,
        ),
        Err(error) => {
            eprintln!("sandboxd failed to append liveness journal event '{event}': {error}");
            supervisor_handle.set_component_detail(
                crate::supervision::SupervisedComponent::Sandboxd,
                DAEMON_LIVENESS_JOURNAL_ERROR_DETAIL,
                error,
            );
        }
    }
}

fn collect_liveness_sample(
    config: &DaemonLivenessConfig,
    observed_at_ms: u64,
    lag_ms: u64,
    threshold_ms: u64,
) -> DaemonLivenessSample {
    let mut details = BTreeMap::from([
        (
            "samplerIntervalMs".to_string(),
            duration_millis(config.sample_interval).to_string(),
        ),
        ("lagThresholdMs".to_string(), threshold_ms.to_string()),
        ("lastLagMs".to_string(), lag_ms.to_string()),
    ]);

    match sample_resource_details(&config.proc_root, &config.cgroup_root) {
        Ok(resource_details) => details.extend(resource_details),
        Err(error) => {
            details.insert("resourceProbeError".to_string(), error);
        }
    }

    DaemonLivenessSample {
        observed_at_ms,
        lag_ms,
        threshold_ms,
        details,
    }
}

fn append_liveness_journal_event(
    journal_path: &Path,
    clock: &dyn Clock,
    sandbox_instance_id: &str,
    level: &str,
    event: &str,
    sample: &DaemonLivenessSample,
) -> Result<(), String> {
    if let Some(parent) = journal_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create sandboxd liveness journal directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let timestamp = format_rfc3339_timestamp(clock.now_system_time())
        .map_err(|error| format!("failed to format liveness journal timestamp: {error}"))?;
    let mut payload = Map::new();
    payload.insert("timestamp".to_string(), Value::String(timestamp));
    payload.insert("level".to_string(), Value::String(level.to_string()));
    payload.insert("event".to_string(), Value::String(event.to_string()));
    payload.insert(
        "sandboxInstanceId".to_string(),
        Value::String(sandbox_instance_id.to_string()),
    );
    payload.insert(
        "observedAtMs".to_string(),
        Value::from(sample.observed_at_ms),
    );
    payload.insert("lagMs".to_string(), Value::from(sample.lag_ms));
    payload.insert("thresholdMs".to_string(), Value::from(sample.threshold_ms));
    for (key, value) in &sample.details {
        payload.insert(key.clone(), Value::String(value.clone()));
    }

    let mut line = serde_json::to_string(&Value::Object(payload))
        .map_err(|error| format!("failed to serialize liveness journal event: {error}"))?;
    line.push('\n');

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(journal_path)
        .map_err(|error| {
            format!(
                "failed to open sandboxd liveness journal {}: {error}",
                journal_path.display()
            )
        })?;
    file.write_all(line.as_bytes()).map_err(|error| {
        format!(
            "failed to append sandboxd liveness journal {}: {error}",
            journal_path.display()
        )
    })
}

fn sample_resource_details(
    proc_root: &Path,
    cgroup_root: &Path,
) -> Result<BTreeMap<String, String>, String> {
    let status_path = proc_root.join("self/status");
    let status = fs::read_to_string(&status_path)
        .map_err(|error| format!("failed to read {}: {error}", status_path.display()))?;
    let process_status = parse_process_status(&status)?;

    let fd_path = proc_root.join("self/fd");
    let fd_count = fs::read_dir(&fd_path)
        .map_err(|error| format!("failed to read {}: {error}", fd_path.display()))?
        .count();

    let mut details = BTreeMap::from([
        ("pid".to_string(), std::process::id().to_string()),
        ("rssBytes".to_string(), process_status.rss_bytes.to_string()),
        (
            "threadCount".to_string(),
            process_status.thread_count.to_string(),
        ),
        ("fdCount".to_string(), fd_count.to_string()),
    ]);

    let self_cgroup_path = proc_root.join("self/cgroup");
    let self_cgroup = fs::read_to_string(&self_cgroup_path).map_err(|error| {
        format!(
            "failed to read current cgroup path from {}: {error}",
            self_cgroup_path.display()
        )
    })?;
    let cgroup_relative_path = parse_cgroup_v2_path(&self_cgroup)?;
    let current_cgroup_root = join_cgroup_v2_path(cgroup_root, &cgroup_relative_path);

    let memory_current_path = current_cgroup_root.join("memory.current");
    let memory_current = fs::read_to_string(&memory_current_path).map_err(|error| {
        format!(
            "failed to read cgroup memory usage from {}: {error}",
            memory_current_path.display()
        )
    })?;
    details.insert(
        "cgroupMemoryCurrentBytes".to_string(),
        parse_u64_file_value(&memory_current, &memory_current_path)?.to_string(),
    );

    let memory_events_path = current_cgroup_root.join("memory.events");
    let memory_events = fs::read_to_string(&memory_events_path).map_err(|error| {
        format!(
            "failed to read cgroup memory events from {}: {error}",
            memory_events_path.display()
        )
    })?;
    let parsed_memory_events = parse_memory_events(&memory_events, &memory_events_path)?;
    details.insert(
        "cgroupMemoryOomEvents".to_string(),
        parsed_memory_events.oom.to_string(),
    );
    details.insert(
        "cgroupMemoryOomKillEvents".to_string(),
        parsed_memory_events.oom_kill.to_string(),
    );

    Ok(details)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProcessStatus {
    rss_bytes: u64,
    thread_count: u64,
}

fn parse_process_status(status: &str) -> Result<ProcessStatus, String> {
    let mut rss_bytes = None;
    let mut thread_count = None;

    for line in status.lines() {
        if let Some(value) = line.strip_prefix("VmRSS:") {
            rss_bytes = Some(parse_kib_status_value(value, "VmRSS")?);
        } else if let Some(value) = line.strip_prefix("Threads:") {
            thread_count =
                Some(value.trim().parse::<u64>().map_err(|error| {
                    format!("failed to parse Threads from proc status: {error}")
                })?);
        }
    }

    Ok(ProcessStatus {
        rss_bytes: rss_bytes.ok_or_else(|| "proc status is missing VmRSS".to_string())?,
        thread_count: thread_count.ok_or_else(|| "proc status is missing Threads".to_string())?,
    })
}

fn parse_kib_status_value(value: &str, field: &str) -> Result<u64, String> {
    let mut parts = value.split_whitespace();
    let raw_value = parts
        .next()
        .ok_or_else(|| format!("proc status field {field} is missing a value"))?;
    let unit = parts
        .next()
        .ok_or_else(|| format!("proc status field {field} is missing a unit"))?;
    if unit != "kB" {
        return Err(format!(
            "proc status field {field} has unsupported unit {unit}"
        ));
    }

    raw_value
        .parse::<u64>()
        .map(|kib| kib.saturating_mul(1024))
        .map_err(|error| format!("failed to parse {field} from proc status: {error}"))
}

fn parse_cgroup_v2_path(cgroup: &str) -> Result<PathBuf, String> {
    for line in cgroup.lines() {
        let mut parts = line.splitn(3, ':');
        let hierarchy = parts.next();
        let controllers = parts.next();
        let path = parts.next();
        if hierarchy == Some("0")
            && controllers == Some("")
            && let Some(path) = path
        {
            return Ok(PathBuf::from(path.trim_start_matches('/')));
        }
    }

    Err("current process is not attached to a cgroup v2 hierarchy".to_string())
}

fn join_cgroup_v2_path(cgroup_root: &Path, relative_path: &Path) -> PathBuf {
    if relative_path.as_os_str().is_empty() {
        return cgroup_root.to_path_buf();
    }
    cgroup_root.join(relative_path)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MemoryEvents {
    oom: u64,
    oom_kill: u64,
}

fn parse_memory_events(events: &str, path: &Path) -> Result<MemoryEvents, String> {
    let mut oom = None;
    let mut oom_kill = None;

    for line in events.lines() {
        let Some((key, value)) = line.split_once(' ') else {
            continue;
        };
        match key {
            "oom" => oom = Some(parse_u64_field(value, key, path)?),
            "oom_kill" => oom_kill = Some(parse_u64_field(value, key, path)?),
            _ => {}
        }
    }

    Ok(MemoryEvents {
        oom: oom.ok_or_else(|| format!("{} is missing oom", path.display()))?,
        oom_kill: oom_kill.ok_or_else(|| format!("{} is missing oom_kill", path.display()))?,
    })
}

fn parse_u64_file_value(value: &str, path: &Path) -> Result<u64, String> {
    value.trim().parse::<u64>().map_err(|error| {
        format!(
            "failed to parse numeric value from {}: {error}",
            path.display()
        )
    })
}

fn parse_u64_field(value: &str, field: &str, path: &Path) -> Result<u64, String> {
    value.trim().parse::<u64>().map_err(|error| {
        format!(
            "failed to parse field {field} from {}: {error}",
            path.display()
        )
    })
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

fn elapsed_lag_ms(elapsed: Duration, expected_interval: Duration) -> u64 {
    duration_millis(elapsed.saturating_sub(expected_interval))
}

fn liveness_journal_path() -> PathBuf {
    std::env::var_os(LIVENESS_JOURNAL_PATH_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_LIVENESS_JOURNAL_PATH))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use crate::daemon_liveness::{
        DaemonLivenessAction, DaemonLivenessConfig, DaemonLivenessSample, DaemonLivenessState,
        append_liveness_journal_event, collect_liveness_sample, elapsed_lag_ms,
        parse_cgroup_v2_path, parse_memory_events, parse_process_status,
        record_liveness_journal_edge,
    };
    use crate::supervision::{
        DAEMON_LIVENESS_JOURNAL_ERROR_DETAIL, SandboxdSupervisorHandle, SupervisedComponent,
    };
    use crate::time::testing::MutableClock;

    #[test]
    fn parses_process_status_resource_fields() {
        let status = "Name:\tsandboxd\nVmRSS:\t  1234 kB\nThreads:\t7\n";

        let parsed = parse_process_status(status).expect("status should parse");

        assert_eq!(parsed.rss_bytes, 1_263_616);
        assert_eq!(parsed.thread_count, 7);
    }

    #[test]
    fn parses_cgroup_v2_path_from_proc_self_cgroup() {
        let path =
            parse_cgroup_v2_path("0::/docker/abc\n").expect("cgroup v2 path should be parsed");

        assert_eq!(path, PathBuf::from("docker/abc"));
    }

    #[test]
    fn parses_memory_oom_counters() {
        let events = "low 0\nhigh 1\noom 2\noom_kill 3\noom_group_kill 0\n";

        let parsed = parse_memory_events(events, &PathBuf::from("/sys/fs/cgroup/memory.events"))
            .expect("memory events should parse");

        assert_eq!(parsed.oom, 2);
        assert_eq!(parsed.oom_kill, 3);
    }

    #[test]
    fn reports_resource_probe_errors_in_liveness_sample_details() {
        let config = DaemonLivenessConfig {
            proc_root: PathBuf::from("/definitely/missing/proc"),
            ..DaemonLivenessConfig::default()
        };

        let sample = collect_liveness_sample(&config, 1_000, 25, 30_000);

        assert_eq!(
            sample.details.get("resourceProbeError").map(String::as_str),
            Some(
                "failed to read /definitely/missing/proc/self/status: No such file or directory (os error 2)"
            )
        );
    }

    #[test]
    fn emits_lag_and_recovery_only_on_state_edges() {
        let mut state = DaemonLivenessState::default();
        let mut healthy_sample = sample_with_lag(10);
        let mut lag_sample = sample_with_lag(40_000);
        let mut repeated_lag_sample = sample_with_lag(45_000);
        let mut recovered_sample = sample_with_lag(5);

        assert_eq!(
            state.evaluate(&mut healthy_sample),
            DaemonLivenessAction::SampleOnly
        );
        assert_eq!(
            state.evaluate(&mut lag_sample),
            DaemonLivenessAction::LagDetected
        );
        assert_eq!(
            state.evaluate(&mut repeated_lag_sample),
            DaemonLivenessAction::SampleOnly
        );
        assert_eq!(
            state.evaluate(&mut recovered_sample),
            DaemonLivenessAction::Recovered
        );
        assert_eq!(
            recovered_sample.details.get("maxLagMs").map(String::as_str),
            Some("45000")
        );
    }

    #[test]
    fn appends_edge_events_to_durable_journal() {
        let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
        let path = temp_dir.path().join("liveness.log");
        let clock = MutableClock::new(104);
        let sample = sample_with_lag(40_000);

        append_liveness_journal_event(
            &path,
            &clock,
            "sbi_123",
            "warn",
            "daemon_liveness_lag_detected",
            &sample,
        )
        .expect("journal event should append");

        let journal = std::fs::read_to_string(path).expect("journal should be readable");
        let record: serde_json::Value =
            serde_json::from_str(&journal).expect("journal line should be json");
        assert_eq!(record["timestamp"], "1970-01-01T00:00:00.104Z");
        assert_eq!(record["event"], "daemon_liveness_lag_detected");
        assert_eq!(record["sandboxInstanceId"], "sbi_123");
        assert_eq!(record["lagMs"], 40_000);
    }

    #[test]
    fn scheduler_lag_uses_elapsed_monotonic_time() {
        assert_eq!(
            elapsed_lag_ms(Duration::from_millis(10_005), Duration::from_secs(10)),
            5
        );
        assert_eq!(
            elapsed_lag_ms(Duration::from_millis(9_995), Duration::from_secs(10)),
            0
        );
    }

    #[test]
    fn journal_append_errors_are_recorded_without_failing_the_edge() {
        let temp_dir = tempfile::TempDir::new().expect("temp dir should be created");
        let clock = Arc::new(MutableClock::new(104));
        let supervisor_handle = SandboxdSupervisorHandle::new(
            "sbi_123",
            clock.clone(),
            BTreeSet::from([SupervisedComponent::Sandboxd]),
        );
        let sample = sample_with_lag(40_000);

        record_liveness_journal_edge(
            &supervisor_handle,
            temp_dir.path(),
            clock.as_ref(),
            "sbi_123",
            "warn",
            "daemon_liveness_lag_detected",
            &sample,
        );

        let snapshot = supervisor_handle
            .component_snapshot(SupervisedComponent::Sandboxd)
            .expect("sandboxd component should be tracked");
        assert!(
            snapshot
                .details
                .contains_key(DAEMON_LIVENESS_JOURNAL_ERROR_DETAIL),
            "journal write failure should remain visible in health details"
        );
    }

    fn sample_with_lag(lag_ms: u64) -> DaemonLivenessSample {
        DaemonLivenessSample {
            observed_at_ms: 1_000,
            lag_ms,
            threshold_ms: 30_000,
            details: std::collections::BTreeMap::from([(
                "lastLagMs".to_string(),
                lag_ms.to_string(),
            )]),
        }
    }
}
