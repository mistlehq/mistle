#![cfg(target_os = "linux")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;

use sandboxd::pty::{
    DEFAULT_PTY_TERMINATE_POLL_INTERVAL, DEFAULT_PTY_TERMINATE_TIMEOUT_MS, PtySpawnRequest,
    start_scoped_pty_session,
};
use sandboxd::time::{Clock, Sleeper, SystemClock, ThreadSleeper};

static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn foreground_pty_command_exits_when_session_terminates() {
    let test_dir = create_temp_test_dir("pty_foreground_exit");
    let shell_pid_path = test_dir.join("shell.pid");
    let cgroup_root = test_dir.join("cgroup-root");
    fs::create_dir_all(&cgroup_root).expect("cgroup root should be creatable");

    let session = start_scoped_pty_session(
        PtySpawnRequest {
            command: Some("/bin/sh".to_string()),
            args: Some(vec![
                "-lc".to_string(),
                format!("echo $$ > {}; sleep 30", shell_pid_path.display()),
            ]),
            ..PtySpawnRequest::default()
        },
        &cgroup_root,
        "sbi_123",
        &SystemClock,
        &ThreadSleeper,
    )
    .expect("scoped pty session should start");

    let shell_pid = read_pid_file_with_retry(&shell_pid_path, &SystemClock, &ThreadSleeper)
        .expect("shell pid should be written");

    session
        .terminate(
            &SystemClock,
            &ThreadSleeper,
            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
        )
        .expect("foreground termination should succeed");

    wait_for_process_exit(shell_pid, &SystemClock, &ThreadSleeper)
        .expect("foreground shell should exit after PTY termination");

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn backgrounded_process_can_survive_pty_termination() {
    let test_dir = create_temp_test_dir("pty_background_survives");
    let background_pid_path = test_dir.join("background.pid");
    let cgroup_root = test_dir.join("cgroup-root");
    fs::create_dir_all(&cgroup_root).expect("cgroup root should be creatable");

    let session = start_scoped_pty_session(
        PtySpawnRequest {
            command: Some("/bin/sh".to_string()),
            args: Some(vec![
                "-lc".to_string(),
                format!(
                    "nohup sh -c 'echo $$ > {}; sleep 30' >/dev/null 2>&1 & cat",
                    background_pid_path.display()
                ),
            ]),
            ..PtySpawnRequest::default()
        },
        &cgroup_root,
        "sbi_123",
        &SystemClock,
        &ThreadSleeper,
    )
    .expect("scoped pty session should start");

    let background_pid =
        read_pid_file_with_retry(&background_pid_path, &SystemClock, &ThreadSleeper)
            .expect("background pid should be written");

    session
        .terminate(
            &SystemClock,
            &ThreadSleeper,
            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
        )
        .expect("backgrounded termination should succeed");

    assert!(
        process_is_alive(background_pid),
        "backgrounded child should survive PTY termination"
    );
    kill_process(background_pid);

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

#[test]
fn detached_session_equivalent_can_survive_pty_termination() {
    let test_dir = create_temp_test_dir("pty_detached_survives");
    let detached_pid_path = test_dir.join("detached.pid");
    let cgroup_root = test_dir.join("cgroup-root");
    fs::create_dir_all(&cgroup_root).expect("cgroup root should be creatable");

    let session = start_scoped_pty_session(
        PtySpawnRequest {
            command: Some("/bin/sh".to_string()),
            args: Some(vec![
                "-lc".to_string(),
                format!(
                    "setsid sh -c 'echo $$ > {}; sleep 30' >/dev/null 2>&1 < /dev/null & cat",
                    detached_pid_path.display()
                ),
            ]),
            ..PtySpawnRequest::default()
        },
        &cgroup_root,
        "sbi_123",
        &SystemClock,
        &ThreadSleeper,
    )
    .expect("scoped pty session should start");

    let detached_pid = read_pid_file_with_retry(&detached_pid_path, &SystemClock, &ThreadSleeper)
        .expect("detached pid should be written");

    session
        .terminate(
            &SystemClock,
            &ThreadSleeper,
            DEFAULT_PTY_TERMINATE_POLL_INTERVAL,
            DEFAULT_PTY_TERMINATE_TIMEOUT_MS,
        )
        .expect("detached termination should succeed");

    assert!(
        process_is_alive(detached_pid),
        "detached child should survive PTY termination"
    );
    kill_process(detached_pid);

    fs::remove_dir_all(test_dir).expect("temp test dir should be removable");
}

fn read_pid_file_with_retry(
    path: &Path,
    clock: &dyn Clock,
    sleeper: &dyn Sleeper,
) -> Result<i32, String> {
    let deadline_ms = clock.now_ms().saturating_add(5_000);
    loop {
        if let Ok(contents) = fs::read_to_string(path) {
            let trimmed = contents.trim();
            if !trimmed.is_empty() {
                return trimmed.parse::<i32>().map_err(|error| {
                    format!("pid file at {} is invalid: {error}", path.display())
                });
            }
        }

        if clock.now_ms() >= deadline_ms {
            return Err(format!("timed out waiting for pid file {}", path.display()));
        }

        sleeper.sleep(Duration::from_millis(10));
    }
}

fn wait_for_process_exit(pid: i32, clock: &dyn Clock, sleeper: &dyn Sleeper) -> Result<(), String> {
    let deadline_ms = clock.now_ms().saturating_add(5_000);
    loop {
        if !process_is_alive(pid) {
            return Ok(());
        }

        if clock.now_ms() >= deadline_ms {
            return Err(format!("timed out waiting for process {pid} to exit"));
        }

        sleeper.sleep(Duration::from_millis(10));
    }
}

fn process_is_alive(pid: i32) -> bool {
    Path::new("/proc").join(pid.to_string()).exists()
}

fn kill_process(pid: i32) {
    let _ = kill(Pid::from_raw(pid), Signal::SIGKILL);
}

fn create_temp_test_dir(prefix: &str) -> PathBuf {
    let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let unique_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let path = Path::new("/tmp").join(format!(
        "sbd_{prefix}_{}_{}_{}",
        std::process::id(),
        counter,
        unique_suffix
    ));

    fs::create_dir_all(&path).expect("temp test dir should be creatable");
    path
}
